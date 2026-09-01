import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { AlreadyExists, NotAuthorized, NotFound } from '@codementor/kernel';
import {
  DEFAULT_PAGE_LIMIT,
  IMAGE_CONTENT_TYPES,
  ObjectStorageService,
  decodeCursor,
  requireHumanId,
  toPage,
  ContentAuthorLookup,
  type AuthenticatedUser,
  type Page,
  type PresignedUpload,
} from '@codementor/platform';
import { Article, type ArticleEdit } from '../domain/model/article';
import {
  ARTICLE_CONTENT_REPOSITORY,
  ARTICLE_REPOSITORY,
  type ArticleContentRepository,
  type ArticleListItem,
  type ArticleRepository,
} from '../domain/port/article.repository';

export interface ListArticlesQuery {
  status?: string;
  q?: string;
  tag?: string;
  limit?: number;
  cursor?: string;
}

export interface ArticleView {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  takeaway: string | null;
  coverImageUrl: string | null;
  authorId: string | null;
  tagId: string | null;
  readMinutes: number | null;
  status: string;
  rejectionReason: string | null;
  removalRequested: boolean;
  authorName: string | null;
  tagName: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contentHtml: string;
}

function slugify(title: string, suffix?: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  const stem = base.length >= 3 ? base : `bai-viet-${Date.now().toString(36)}`;
  return suffix ? `${stem}-${suffix}` : stem;
}

/**
 * Bài viết biên tập. Chỉ admin soạn và đăng — không có hàng chờ duyệt như khóa học.
 *
 * Kiểm vai trò ngay trong use case dù controller đã có `@Roles('admin')`: guard bảo vệ
 * đường HTTP, use case là thứ mọi lối gọi khác (job, consumer Kafka) cũng đi qua.
 */
@Injectable()
export class ArticleUseCases {
  private readonly logger = new Logger(ArticleUseCases.name);

  constructor(
    @Inject(ARTICLE_REPOSITORY) private readonly articles: ArticleRepository,
    @Inject(ARTICLE_CONTENT_REPOSITORY) private readonly contents: ArticleContentRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
    private readonly authors: ContentAuthorLookup,
    private readonly storage: ObjectStorageService,
  ) {}

  coverUploadConfig(): { enabled: boolean; maxBytes: number; acceptedTypes: string[] } {
    return {
      enabled: this.storage.isConfigured,
      maxBytes: this.storage.maxImageUploadBytes,
      acceptedTypes: [...IMAGE_CONTENT_TYPES],
    };
  }

  async presignCoverImage(
    user: AuthenticatedUser,
    id: string,
    input: { filename: string; contentType: string; sizeBytes: number },
  ): Promise<PresignedUpload> {
    const article = await this.mustEdit(user, id);
    const signed = await this.storage.presignImageUpload({
      prefix: `articles/${article.id}/cover`,
      ...input,
    });
    if (signed.isFail) throw signed.error;
    return signed.value;
  }

  /**
   * Phát một sự kiện thông báo mà KHÔNG để nó làm hỏng thao tác vừa xong.
   *
   * Bài đã đổi trạng thái trong Postgres rồi; Kafka chết ở bước này không được biến một
   * lần gửi duyệt thành công thành lỗi 500 trên màn hình giảng viên. Cùng đánh đổi mà
   * `moderate` đã chọn cho `ARTICLE_PUBLISHED`.
   */
  private async announce(fire: () => Promise<unknown>, what: string): Promise<void> {
    try {
      await fire();
    } catch (error) {
      this.logger.error(`không phát được ${what}`, error as Error);
    }
  }

  /** Danh mục công khai — đường đọc của người học, không cần đăng nhập vai trò nào. */
  async catalogue(query: ListArticlesQuery): Promise<Page<ArticleListItem>> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    const rows = await this.articles.list({
      publishedOnly: true,
      q: query.q,
      tag: query.tag,
      limit,
      cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
    });
    return toPage(rows, limit);
  }

  /** Chủ đề của bài đã công khai, cho dãy chip lọc ở trang bài viết. */
  tags(): Promise<{ name: string; count: number }[]> {
    return this.articles.publishedTags();
  }

  /**
   * Danh sách soạn thảo. Admin thấy mọi bài; giảng viên chỉ thấy bài của mình.
   *
   * Lọc theo tác giả ở TRUY VẤN chứ không lọc sau khi lấy về: lọc sau thì trang đầu tiên
   * của một giảng viên mới sẽ rỗng dù họ có bài, và phân trang đếm sai ngay từ đầu.
   */
  async list(user: AuthenticatedUser, query: ListArticlesQuery): Promise<Page<ArticleListItem>> {
    this.mustAuthor(user);
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    const rows = await this.articles.list({
      publishedOnly: false,
      status: query.status,
      q: query.q,
      authorId: user.role === 'admin' ? undefined : requireHumanId(user),
      limit,
      cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
    });
    return toPage(rows, limit);
  }

  /** Đọc theo slug — bài chưa công khai chỉ admin xem được (dùng cho preview). */
  async getBySlug(user: AuthenticatedUser | null, slug: string): Promise<ArticleView> {
    const article = await this.articles.findBySlug(slug);
    if (article === null) throw new NotFound('Bài viết', slug);
    if (article.status !== 'published' && user?.role !== 'admin') {
      throw new NotFound('Bài viết', slug);
    }
    return this.toView(article);
  }

  async get(user: AuthenticatedUser, id: string): Promise<ArticleView> {
    return this.toView(await this.mustEdit(user, id));
  }

  async create(
    user: AuthenticatedUser,
    input: { title: string; slug?: string },
  ): Promise<ArticleView> {
    this.mustAuthor(user);
    const slug = await this.freeSlug(input.slug, input.title);
    const created = Article.create({
      id: randomUUID(),
      slug,
      title: input.title,
      authorId: requireHumanId(user),
    });
    if (created.isFail) throw created.error;

    await this.articles.save(created.value);
    return this.toView(created.value);
  }

  async update(user: AuthenticatedUser, id: string, edit: ArticleEdit): Promise<ArticleView> {
    const article = await this.mustEdit(user, id);

    if (edit.slug !== undefined && edit.slug !== article.slug) {
      if (await this.articles.existsBySlug(edit.slug)) {
        throw new AlreadyExists('Slug', { slug: edit.slug });
      }
    }
    const edited = article.edit(edit);
    if (edited.isFail) throw edited.error;

    await this.articles.save(article);
    return this.toView(article);
  }

  /** Ghi thân bài rồi gắn `content_ref`. Nội dung ở Mongo, con trỏ ở Postgres. */
  async saveContent(
    user: AuthenticatedUser,
    id: string,
    contentHtml: string,
  ): Promise<ArticleView> {
    const article = await this.mustEdit(user, id);

    const contentRef = await this.contents.save(id, { contentHtml });
    article.attachContent(contentRef);
    await this.articles.save(article);
    return this.toView(article);
  }

  /**
   * Người viết gửi bài đi duyệt.
   *
   * Sự kiện phát ở đây KHÔNG phải "có bài mới cho người học" — bài vẫn là bản nháp. Nó
   * gửi cho admin, những người duy nhất làm được gì với nó.
   */
  async submit(user: AuthenticatedUser, id: string): Promise<ArticleView> {
    const article = await this.mustEdit(user, id);
    const submitted = article.submit();
    if (submitted.isFail) throw submitted.error;

    await this.articles.save(article);
    await this.announce(
      () =>
        this.eventBus.publish(TOPICS.CONTENT_REVIEW_REQUESTED, {
          kind: 'POST',
          contentId: article.id,
          slug: article.slug,
          title: article.title,
          // Người gửi chính là tác giả, nên tên lấy thẳng từ token — không cần tra bảng.
          authorName: user.displayName,
        }),
      `${TOPICS.CONTENT_REVIEW_REQUESTED} cho ${article.id}`,
    );
    return this.toView(article);
  }

  /** Người viết rút bài khỏi hàng chờ. */
  async withdraw(user: AuthenticatedUser, id: string): Promise<ArticleView> {
    const article = await this.mustEdit(user, id);
    const result = article.withdraw();
    if (result.isFail) throw result.error;

    await this.articles.save(article);
    return this.toView(article);
  }

  /** Hàng chờ duyệt — mọi tác giả, chỉ `pending_review`. Chỉ admin xem. */
  async moderationQueue(
    user: AuthenticatedUser,
    query: ListArticlesQuery,
  ): Promise<Page<ArticleListItem>> {
    if (user.role !== 'admin') throw new NotAuthorized('xem hàng chờ duyệt');
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    const rows = await this.articles.list({
      publishedOnly: false,
      // `?status=` để xem lại những gì ĐÃ quyết, không chỉ những gì đang chờ. Không có nó
      // thì một lần bấm nhầm Từ chối là không có đường tìm lại bài đó để hoàn tác — cùng
      // hình dạng mà khoá học, lộ trình và bài code đã dùng ở `list()`.
      pendingOnly: query.status === undefined,
      status: query.status,
      limit,
      cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
    });
    return toPage(rows, limit);
  }

  /**
   * Quyết định của admin. Chỉ khi DUYỆT và bài chưa từng công khai mới phát sự kiện —
   * duyệt lại một bài đã đăng không được báo "bài viết mới" lần nữa.
   */
  async moderate(
    user: AuthenticatedUser,
    id: string,
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore' | 'revert',
    reason: string | null,
  ): Promise<ArticleView> {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const article = await this.mustFind(id);
    const moderated = article.moderate(decision, reason);
    if (moderated.isFail) throw moderated.error;

    await this.articles.save(article);

    if (moderated.value.firstPublish) {
      await this.announce(
        () =>
          this.eventBus.publish(TOPICS.ARTICLE_PUBLISHED, {
            articleId: article.id,
            slug: article.slug,
            title: article.title,
            excerpt: article.excerpt,
          }),
        `${TOPICS.ARTICLE_PUBLISHED} cho ${article.id}`,
      );
    }

    // `restore` và `revert` không sinh thông báo nào, nhưng VẪN phát sự kiện: đó là nguồn
    // dữ liệu duy nhất của nhật ký kiểm toán. Việc lọc nằm ở `fromContentModerated`.
    await this.notifyAuthor(article, decision, reason, user);
    return this.toView(article);
  }

  /**
   * Sự kiện thứ hai, người nhận khác hẳn `ARTICLE_PUBLISHED`: cái kia báo cho người học
   * rằng có bài mới, cái này báo riêng cho tác giả rằng bài của họ vừa được quyết — kể cả
   * khi quyết định đó là từ chối một yêu cầu XIN GỠ (`deny_removal`), thứ không đi qua
   * `moderate()`. Một lần duyệt sinh cả hai sự kiện; gộp lại thì một trong hai nhóm nhận
   * nhầm thông báo.
   */
  private async notifyAuthor(
    article: Article,
    decision:
      'approve' | 'request_changes' | 'reject' | 'archive' | 'restore' | 'revert' | 'deny_removal',
    reason: string | null,
    moderator: { displayName: string; externalId: string },
  ): Promise<void> {
    const author = await this.authors.find(article.authorId);
    if (!author?.externalId) return;
    await this.announce(
      () =>
        this.eventBus.publish(TOPICS.CONTENT_MODERATED, {
          kind: 'POST',
          contentId: article.id,
          slug: article.slug,
          title: article.title,
          decision,
          reason,
          authorExternalId: author.externalId as string,
          moderatorName: moderator.displayName,
          moderatorExternalId: moderator.externalId,
        }),
      `${TOPICS.CONTENT_MODERATED} cho ${article.id}`,
    );
  }

  /**
   * Tác giả XIN gỡ bài đang công khai của mình — không tự gỡ được nữa, chỉ ghi lại
   * nguyện vọng kèm lý do bắt buộc. Bài vẫn `published` cho tới khi admin quyết
   * (`moderate('archive', ...)` để duyệt, `denyRemoval` để từ chối).
   */
  async requestRemoval(user: AuthenticatedUser, id: string, reason: string): Promise<ArticleView> {
    const article = await this.mustEdit(user, id);
    const requested = article.requestRemoval(reason);
    if (requested.isFail) throw requested.error;

    await this.articles.save(article);
    // Người nhận là ADMIN — xem chú thích đầy đủ ở `CourseUseCases.requestRemoval`.
    await this.announce(
      () =>
        this.eventBus.publish(TOPICS.CONTENT_REMOVAL_REQUESTED, {
          kind: 'POST',
          contentId: article.id,
          slug: article.slug,
          title: article.title,
          reason: reason.trim(),
          authorName: user.displayName,
        }),
      `${TOPICS.CONTENT_REMOVAL_REQUESTED} cho ${article.id}`,
    );
    return this.toView(article);
  }

  /** Admin từ chối yêu cầu xin gỡ — bài không đổi gì, chỉ báo lại cho tác giả. */
  async denyRemoval(user: AuthenticatedUser, id: string): Promise<ArticleView> {
    if (user.role !== 'admin') throw new NotAuthorized('xử lý yêu cầu xin gỡ');
    const article = await this.mustFind(id);
    const denied = article.denyRemoval();
    if (denied.isFail) throw denied.error;

    await this.articles.save(article);
    await this.notifyAuthor(article, 'deny_removal', null, user);
    return this.toView(article);
  }

  /** Tác giả tự khôi phục bài đã gỡ của mình — về draft, đi lại vòng duyệt. */
  async restoreMine(user: AuthenticatedUser, id: string): Promise<ArticleView> {
    const article = await this.mustEdit(user, id);
    const restored = article.moderate('restore', null);
    if (restored.isFail) throw restored.error;

    await this.articles.save(article);
    return this.toView(article);
  }

  /**
   * Xoá hẳn. Chỉ cho phép với bài CHƯA từng công khai — bài đã đăng thì dùng lưu trữ,
   * vì đường dẫn của nó có thể đã nằm trong thông báo đã gửi và trong lịch sử trình duyệt.
   */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const article = await this.mustEdit(user, id);
    if (article.publishedAt !== null) {
      throw new NotAuthorized('xoá bài viết đã từng công khai — hãy dùng lưu trữ');
    }
    await this.contents.delete(id);
    await this.articles.delete(id);
  }

  /**
   * Đếm bài viết theo trạng thái.
   *
   * Lọc theo tác giả y hệt list(): giảng viên chỉ thấy bài của chính mình ở danh sách,
   * nên con số trên bảng điều khiển của họ phải đếm cùng một tập. Trước đây hàm này đếm
   * TOÀN BỘ bảng, nên một giảng viên có ba bài vẫn thấy "10 đã đăng" — vừa sai, vừa để lộ
   * quy mô nội dung của cả nền tảng.
   */
  countByStatus(user: AuthenticatedUser): Promise<Record<string, number>> {
    this.mustAuthor(user);
    return this.articles.countByStatus(user.role === 'admin' ? undefined : requireHumanId(user));
  }

  private async toView(article: Article): Promise<ArticleView> {
    // Hai truy vấn song song: thân bài ở Mongo, tên tác giả/chủ đề ở Postgres.
    const [content, described] = await Promise.all([
      this.contents.find(article.id),
      this.articles.describe(article.id),
    ]);

    return {
      id: article.id,
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      takeaway: article.takeaway,
      coverImageUrl: article.coverImageUrl,
      authorId: article.authorId,
      tagId: article.tagId,
      readMinutes: article.readMinutes,
      status: article.status,
      rejectionReason: article.rejectionReason,
      removalRequested: article.removalRequested,
      authorName: described.authorName,
      tagName: described.tagName,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      createdAt: article.createdAt.toISOString(),
      updatedAt: article.updatedAt.toISOString(),
      contentHtml: content?.contentHtml ?? '',
    };
  }

  /** Ai được soạn bài: giảng viên và quản trị. Học viên thì không. */
  private mustAuthor(user: AuthenticatedUser): void {
    if (user.role !== 'admin' && user.role !== 'lecturer') {
      throw new NotAuthorized('soạn bài viết');
    }
  }

  /**
   * Bài mà người này được sửa. Giảng viên chỉ đụng được bài của chính mình; admin đụng
   * được mọi bài.
   *
   * Kiểm quyền sở hữu Ở ĐÂY chứ không ở controller: mọi thao tác sửa/đăng/gỡ/xoá đều đi
   * qua hàm này, nên không có đường nào bỏ sót được — thêm một endpoint mới cũng vậy.
   */
  private async mustEdit(user: AuthenticatedUser, id: string): Promise<Article> {
    this.mustAuthor(user);
    const article = await this.mustFind(id);
    if (user.role !== 'admin' && article.authorId !== requireHumanId(user)) {
      throw new NotAuthorized('thao tác trên bài viết của người khác');
    }
    return article;
  }

  private async mustFind(id: string): Promise<Article> {
    const article = await this.articles.findById(id);
    if (article === null) throw new NotFound('Bài viết', id);
    return article;
  }

  private async freeSlug(explicit: string | undefined, title: string): Promise<string> {
    if (explicit) {
      if (await this.articles.existsBySlug(explicit)) {
        throw new AlreadyExists('Slug', { slug: explicit });
      }
      return explicit;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = slugify(
        title,
        attempt === 0 ? undefined : Math.random().toString(36).slice(2, 7),
      );
      if (!(await this.articles.existsBySlug(candidate))) return candidate;
    }
    throw new AlreadyExists('Slug', { title });
  }
}
