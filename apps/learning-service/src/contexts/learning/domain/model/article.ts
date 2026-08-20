import { AggregateRoot, BusinessRuleViolation, InvalidInput, Result } from '@codementor/kernel';
import type { ContentStatus } from './roadmap';

interface ArticleProps {
  slug: string;
  title: string;
  excerpt: string | null;
  takeaway: string | null;
  authorId: string | null;
  tagId: string | null;
  readMinutes: number | null;
  status: ContentStatus;
  /** `_id` của tài liệu trong MongoDB `article_contents`. */
  contentRef: string | null;
  /** Lý do admin từ chối hoặc yêu cầu sửa. Xoá về null mỗi lần bài được duyệt. */
  rejectionReason: string | null;
  /**
   * Đặt ở lần công khai ĐẦU TIÊN và không bao giờ bị xoá, kể cả khi gỡ xuống rồi đăng
   * lại. Đây chính là thứ quyết định có phát `evt.article.published.v1` hay không —
   * xem `publish()`.
   */
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleEdit {
  slug?: string;
  title?: string;
  excerpt?: string | null;
  takeaway?: string | null;
  tagId?: string | null;
  readMinutes?: number | null;
}

const MAX_TITLE = 200;
const MAX_EXCERPT = 500;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/;

/**
 * Bài viết biên tập — phần "post" của hệ thống.
 *
 * Chỉ dùng ba trạng thái của enum `content_status`: `draft`, `published`, `archived`.
 * Bài viết do admin tự soạn và tự đăng nên không đi qua hàng chờ duyệt như khóa học hay
 * bài tập — thêm `pending_review` vào đây sẽ tạo ra một quy trình không ai vận hành.
 *
 * Thân bài nằm ở MongoDB `article_contents` (mảng `sections`), aggregate này chỉ giữ
 * `contentRef`: nội dung dài, hình dạng thay đổi, và không có ràng buộc quan hệ nào.
 */
export class Article extends AggregateRoot<string> {
  private constructor(
    id: string,
    private props: ArticleProps,
  ) {
    super(id);
  }

  static rehydrate(id: string, props: ArticleProps): Article {
    return new Article(id, props);
  }

  static create(params: {
    id: string;
    slug: string;
    title: string;
    authorId: string;
  }): Result<Article, InvalidInput> {
    const title = params.title.trim();
    if (title.length === 0 || title.length > MAX_TITLE) {
      return Result.fail(new InvalidInput(`Tiêu đề phải dài 1–${MAX_TITLE} ký tự`));
    }
    if (!SLUG_PATTERN.test(params.slug)) {
      return Result.fail(
        new InvalidInput(
          'Slug phải dài 3–80 ký tự, chỉ gồm chữ thường, số và gạch ngang',
          { slug: params.slug },
        ),
      );
    }

    const now = new Date();
    return Result.ok(
      new Article(params.id, {
        slug: params.slug,
        title,
        excerpt: null,
        takeaway: null,
        authorId: params.authorId,
        tagId: null,
        readMinutes: null,
        status: 'draft',
        contentRef: null,
        rejectionReason: null,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  edit(changes: ArticleEdit): Result<true, InvalidInput> {
    if (changes.title !== undefined) {
      const title = changes.title.trim();
      if (title.length === 0 || title.length > MAX_TITLE) {
        return Result.fail(new InvalidInput(`Tiêu đề phải dài 1–${MAX_TITLE} ký tự`));
      }
      this.props.title = title;
    }
    if (changes.slug !== undefined) {
      if (!SLUG_PATTERN.test(changes.slug)) {
        return Result.fail(new InvalidInput('Slug không hợp lệ', { slug: changes.slug }));
      }
      // Slug là địa chỉ công khai của bài. Đổi nó sau khi đã đăng là làm hỏng mọi liên
      // kết đã gửi đi — kể cả nút "Đọc bài viết" trong những thông báo đã phát.
      if (this.props.publishedAt !== null && changes.slug !== this.props.slug) {
        return Result.fail(
          new InvalidInput('Không đổi được slug của bài đã từng công khai'),
        );
      }
      this.props.slug = changes.slug;
    }
    if (changes.excerpt !== undefined) {
      const excerpt = changes.excerpt?.trim() || null;
      if (excerpt !== null && excerpt.length > MAX_EXCERPT) {
        return Result.fail(new InvalidInput(`Tóm tắt tối đa ${MAX_EXCERPT} ký tự`));
      }
      this.props.excerpt = excerpt;
    }
    if (changes.takeaway !== undefined) this.props.takeaway = changes.takeaway?.trim() || null;
    if (changes.tagId !== undefined) this.props.tagId = changes.tagId;
    if (changes.readMinutes !== undefined) {
      if (changes.readMinutes !== null && changes.readMinutes < 1) {
        return Result.fail(new InvalidInput('Thời gian đọc phải từ 1 phút trở lên'));
      }
      this.props.readMinutes = changes.readMinutes;
    }

    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  attachContent(contentRef: string): void {
    this.props.contentRef = contentRef;
    this.props.updatedAt = new Date();
  }

  /**
   * Gửi bài đi duyệt. Đây là thao tác của người viết.
   *
   * Cùng máy trạng thái mà khoá học và lộ trình dùng: `draft`/`changes_requested`/
   * `rejected` → `pending_review`. Người viết không tự đưa bài ra công khai được, kể cả
   * bài của chính họ — quyết định đó thuộc về admin.
   */
  submit(): Result<true, BusinessRuleViolation> {
    // `published` nằm trong danh sách này để một bài đã đăng vẫn sửa được: tác giả lưu
    // bản chỉnh rồi gửi duyệt lại — bản cũ ẩn khỏi danh mục cho tới khi admin duyệt bản
    // mới, không lặng lẽ thay nội dung một bài đang công khai mà không ai xem lại.
    const allowed: ContentStatus[] = ['draft', 'changes_requested', 'rejected', 'published'];
    if (!allowed.includes(this.props.status)) {
      return Result.fail(
        new BusinessRuleViolation(`Không gửi duyệt được từ trạng thái ${this.props.status}`),
      );
    }

    const missing: string[] = [];
    if (!this.props.excerpt?.trim()) missing.push('tóm tắt');
    if (this.props.contentRef === null) missing.push('nội dung');
    if (missing.length > 0) {
      return Result.fail(
        new BusinessRuleViolation(`Chưa gửi duyệt được, còn thiếu: ${missing.join('; ')}`, {
          missing,
        }),
      );
    }

    this.props.status = 'pending_review';
    this.props.rejectionReason = null;
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /**
   * Quyết định của admin. Cùng hình dạng `Course.moderate` — bốn nhánh, cùng enum.
   *
   * Trả `firstPublish` để tầng application biết có nên phát `evt.article.published.v1`
   * hay không: duyệt lại một bài đã từng công khai KHÔNG được bắn thông báo lần nữa,
   * người đọc sẽ nhận "bài viết mới" về đúng thứ họ đọc tuần trước.
   */
  moderate(
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore' | 'revert',
    reason: string | null,
  ): Result<{ firstPublish: boolean }, BusinessRuleViolation | InvalidInput> {
    /** Hoàn tác một quyết định vừa lỡ tay — xem chú thích đầy đủ ở `Course.moderate`. */
    if (decision === 'revert') {
      const revertible: ContentStatus[] = ['rejected', 'changes_requested', 'published'];
      if (!revertible.includes(this.props.status)) {
        return Result.fail(
          new BusinessRuleViolation(
            `Không hoàn tác được từ trạng thái ${this.props.status} — chỉ hoàn tác được quyết định duyệt, từ chối hoặc yêu cầu sửa`,
          ),
        );
      }
      this.props.status = 'pending_review';
      this.props.rejectionReason = null;
      this.props.updatedAt = new Date();
      return Result.ok({ firstPublish: false });
    }

    if (decision === 'archive') {
      if (this.props.status !== 'published') {
        return Result.fail(new BusinessRuleViolation('Chỉ gỡ được nội dung đang công khai'));
      }
      // Bắt buộc nêu lý do, cùng luật với reject/request_changes bên dưới: đây luôn là
      // admin chủ động thu hồi — kể cả khi duyệt một yêu cầu xin gỡ của tác giả, ô này chỉ
      // trống nếu gọi sai chỗ (`requestRemoval` mới là đường tác giả tự xin gỡ).
      if (!reason?.trim()) {
        return Result.fail(new InvalidInput('Phải nêu lý do khi gỡ nội dung đang công khai'));
      }
      this.props.status = 'archived';
      this.props.rejectionReason = reason.trim();
      this.props.updatedAt = new Date();
      return Result.ok({ firstPublish: false });
    }

    /**
     * Đường ra khỏi `archived` — xem chú thích cùng tên ở `Course.moderate`. Về `draft`,
     * KHÔNG về thẳng `published`: bài bị gỡ có thể đã sai hoặc vi phạm, nên đi lại quy
     * trình duyệt như mọi bản nháp khác. `publishedAt` giữ nguyên ngày phát hành đầu tiên.
     */
    if (decision === 'restore') {
      if (this.props.status !== 'archived') {
        return Result.fail(
          new BusinessRuleViolation(`Chỉ khôi phục được nội dung đã gỡ (đang ${this.props.status})`),
        );
      }
      this.props.status = 'draft';
      this.props.rejectionReason = null;
      this.props.updatedAt = new Date();
      return Result.ok({ firstPublish: false });
    }

    if (this.props.status !== 'pending_review') {
      return Result.fail(
        new BusinessRuleViolation(
          `Bài viết không ở trạng thái chờ duyệt (đang ${this.props.status})`,
        ),
      );
    }

    if (decision === 'approve') {
      const firstPublish = this.props.publishedAt === null;
      this.props.status = 'published';
      this.props.publishedAt ??= new Date();
      this.props.rejectionReason = null;
      this.props.updatedAt = new Date();
      return Result.ok({ firstPublish });
    }

    if (!reason?.trim()) {
      return Result.fail(new InvalidInput('Phải nêu lý do khi từ chối hoặc yêu cầu sửa'));
    }
    this.props.status = decision === 'reject' ? 'rejected' : 'changes_requested';
    this.props.rejectionReason = reason.trim();
    this.props.updatedAt = new Date();
    return Result.ok({ firstPublish: false });
  }

  /**
   * Người viết rút bài khỏi hàng chờ — LUÔN về `draft`, không bao giờ về `published`.
   * Cùng lý do đã ghi đầy đủ ở `Course.withdraw`.
   */
  withdraw(): Result<true, BusinessRuleViolation> {
    if (this.props.status !== 'pending_review') {
      return Result.fail(new BusinessRuleViolation('Bài viết không ở trạng thái chờ duyệt'));
    }
    this.props.status = 'draft';
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  archive(): Result<true, BusinessRuleViolation> {
    if (this.props.status === 'archived') {
      return Result.fail(new BusinessRuleViolation('Bài viết đã được lưu trữ'));
    }
    this.props.status = 'archived';
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /** Đang chờ admin duyệt yêu cầu xin gỡ — xem chú thích cùng tên ở `Course`. */
  get removalRequested(): boolean {
    return this.props.status === 'published' && this.props.rejectionReason !== null;
  }

  /** Tác giả xin gỡ bài đang công khai của mình — xem chú thích cùng tên ở `Course`. */
  requestRemoval(reason: string): Result<true, BusinessRuleViolation | InvalidInput> {
    if (this.props.status !== 'published') {
      return Result.fail(new BusinessRuleViolation('Chỉ xin gỡ được nội dung đang công khai'));
    }
    if (!reason.trim()) {
      return Result.fail(new InvalidInput('Phải nêu lý do khi xin gỡ nội dung đang công khai'));
    }
    this.props.rejectionReason = reason.trim();
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /** Admin từ chối yêu cầu xin gỡ — bài viết không đổi gì, chỉ xoá nguyện vọng đang chờ. */
  denyRemoval(): Result<true, BusinessRuleViolation> {
    if (!this.removalRequested) {
      return Result.fail(new BusinessRuleViolation('Không có yêu cầu xin gỡ nào đang chờ'));
    }
    this.props.rejectionReason = null;
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  get slug(): string {
    return this.props.slug;
  }
  get title(): string {
    return this.props.title;
  }
  get excerpt(): string | null {
    return this.props.excerpt;
  }
  get takeaway(): string | null {
    return this.props.takeaway;
  }
  get authorId(): string | null {
    return this.props.authorId;
  }
  get tagId(): string | null {
    return this.props.tagId;
  }
  get readMinutes(): number | null {
    return this.props.readMinutes;
  }
  get status(): ContentStatus {
    return this.props.status;
  }
  get contentRef(): string | null {
    return this.props.contentRef;
  }
  get rejectionReason(): string | null {
    return this.props.rejectionReason;
  }
  get publishedAt(): Date | null {
    return this.props.publishedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
