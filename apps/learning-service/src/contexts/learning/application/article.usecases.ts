import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { AlreadyExists, NotAuthorized, NotFound } from '@codementor/kernel';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  requireHumanId,
  toPage,
  type AuthenticatedUser,
  type Page,
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
  authorId: string | null;
  tagId: string | null;
  readMinutes: number | null;
  status: string;
  rejectionReason: string | null;
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
  ) {}

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
   * Người viết gửi bài đi duyệt. Không phát sự kiện gì ở đây — bài chưa ra công khai.
   */
  async submit(user: AuthenticatedUser, id: string): Promise<ArticleView> {
    const article = await this.mustEdit(user, id);
    const submitted = article.submit();
    if (submitted.isFail) throw submitted.error;

    await this.articles.save(article);
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
      pendingOnly: true,
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
    decision: 'approve' | 'request_changes' | 'reject' | 'archive',
    reason: string | null,
  ): Promise<ArticleView> {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const article = await this.mustFind(id);
    const moderated = article.moderate(decision, reason);
    if (moderated.isFail) throw moderated.error;

    await this.articles.save(article);

    if (moderated.value.firstPublish) {
      // Thông báo là việc phụ: Kafka chết không được làm hỏng thao tác duyệt, vì bài đã
      // `published` trong DB rồi. Cùng đánh đổi với CourseUseCases.moderate.
      try {
        await this.eventBus.publish(TOPICS.ARTICLE_PUBLISHED, {
          articleId: article.id,
          slug: article.slug,
          title: article.title,
          excerpt: article.excerpt,
        });
      } catch (error) {
        this.logger.error(
          `không phát được ${TOPICS.ARTICLE_PUBLISHED} cho ${article.id}`,
          error as Error,
        );
      }
    }
    return this.toView(article);
  }

  /** Gỡ bài đang công khai. Đi qua `moderate('archive')` nên chỉ admin làm được. */
  archive(user: AuthenticatedUser, id: string): Promise<ArticleView> {
    return this.moderate(user, id, 'archive', null);
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

  countByStatus(user: AuthenticatedUser): Promise<Record<string, number>> {
    this.mustAuthor(user);
    return this.articles.countByStatus();
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
      authorId: article.authorId,
      tagId: article.tagId,
      readMinutes: article.readMinutes,
      status: article.status,
      rejectionReason: article.rejectionReason,
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
      const candidate = slugify(title, attempt === 0 ? undefined : Math.random().toString(36).slice(2, 7));
      if (!(await this.articles.existsBySlug(candidate))) return candidate;
    }
    throw new AlreadyExists('Slug', { title });
  }
}
