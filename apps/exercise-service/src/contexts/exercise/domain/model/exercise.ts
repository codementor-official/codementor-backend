import { AggregateRoot, BusinessRuleViolation, InvalidInput, Result } from '@codementor/kernel';
import type { Slug } from './slug';

/** Khớp enum `exercise_status` trong PostgreSQL. */
export type ExerciseStatus =
  | 'draft'
  | 'pending_review'
  | 'changes_requested'
  | 'rejected'
  | 'published'
  | 'closed'
  | 'hidden'
  | 'archived';

/** Khớp enum `exercise_kind`. Phase này studio chỉ sinh ra `code`. */
export type ExerciseKind = 'code' | 'theory' | 'quiz';
export type ExerciseDifficulty = 'easy' | 'medium' | 'hard';
/** Khớp `exercise_visibility`: catalog chung vs chỉ trong nhóm học tập. KHÔNG phải trục duyệt. */
export type ExerciseVisibility = 'public' | 'group';

interface ExerciseProps {
  slug: Slug;
  title: string;
  summary: string | null;
  kind: ExerciseKind;
  difficulty: ExerciseDifficulty;
  status: ExerciseStatus;
  visibility: ExerciseVisibility;
  xpReward: number;
  estimatedMinutes: number | null;
  timeLimitMs: number;
  memoryLimitKb: number;
  authorId: string | null;
  contentRef: string | null;
  /** Chủ đề (`exercise_tags`). Từ vựng dùng chung do core-service sở hữu. */
  tagIds: string[];
  forkedFromId: string | null;
  rejectionReason: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface ExerciseMetadataEdit {
  slug?: Slug;
  title?: string;
  summary?: string | null;
  difficulty?: ExerciseDifficulty;
  xpReward?: number;
  estimatedMinutes?: number | null;
  timeLimitMs?: number;
  memoryLimitKb?: number;
  /** Thay TOÀN BỘ danh sách chủ đề. Mảng rỗng = gỡ hết, khác với vắng mặt = giữ nguyên. */
  tagIds?: string[];
}

// Khớp CHECK của cột trong PostgreSQL. Kiểm ở đây để lỗi ra 400 kèm tên trường,
// thay vì 23514 từ driver.
const LIMITS = {
  timeLimitMs: { min: 100, max: 60_000 },
  memoryLimitKb: { min: 1024, max: 4_194_304 },
} as const;

const MAX_TITLE = 200;

/**
 * Trần số chủ đề mỗi bài. Không phải giới hạn kỹ thuật — một bài gắn hai chục chủ đề thì
 * chủ đề hết còn phân biệt được gì, và đề xuất theo chủ đề cũng hết ý nghĩa theo.
 */
const MAX_TAGS = 8;

/**
 * Bài tập — phần "xương" quan hệ. Thân bài (đề, testcase, starter code) nằm ở MongoDB
 * và KHÔNG thuộc aggregate này; xem `docs/04-design-decisions.md §1`.
 *
 * Aggregate giữ vòng đời trạng thái. Mọi chuyển trạng thái đi qua đây, không service
 * nào được `UPDATE exercises SET status = ...` thẳng.
 */
export class Exercise extends AggregateRoot<string> {
  private constructor(
    id: string,
    private props: ExerciseProps,
  ) {
    super(id);
  }

  static rehydrate(id: string, props: ExerciseProps): Exercise {
    return new Exercise(id, props);
  }

  /** Bài mới luôn ở `draft`: chưa có thân bài thì chưa có gì để duyệt. */
  static create(params: {
    id: string;
    slug: Slug;
    title: string;
    kind: ExerciseKind;
    difficulty: ExerciseDifficulty;
    authorId: string;
    summary?: string | null;
    forkedFromId?: string | null;
  }): Result<Exercise, InvalidInput> {
    const title = params.title.trim();
    if (title.length === 0) return Result.fail(new InvalidInput('Tiêu đề không được để trống'));
    if (title.length > MAX_TITLE) {
      return Result.fail(new InvalidInput(`Tiêu đề tối đa ${MAX_TITLE} ký tự`));
    }

    return Result.ok(
      new Exercise(params.id, {
        slug: params.slug,
        title,
        summary: params.summary?.trim() || null,
        kind: params.kind,
        difficulty: params.difficulty,
        status: 'draft',
        visibility: 'public',
        xpReward: 0,
        estimatedMinutes: null,
        timeLimitMs: 1000,
        memoryLimitKb: 262_144,
        authorId: params.authorId,
        contentRef: null,
        tagIds: [],
        forkedFromId: params.forkedFromId ?? null,
        rejectionReason: null,
        publishedAt: null,
        updatedAt: new Date(),
      }),
    );
  }

  get slug(): Slug {
    return this.props.slug;
  }
  get title(): string {
    return this.props.title;
  }
  get summary(): string | null {
    return this.props.summary;
  }
  get kind(): ExerciseKind {
    return this.props.kind;
  }
  get difficulty(): ExerciseDifficulty {
    return this.props.difficulty;
  }
  get status(): ExerciseStatus {
    return this.props.status;
  }
  get visibility(): ExerciseVisibility {
    return this.props.visibility;
  }
  get xpReward(): number {
    return this.props.xpReward;
  }
  get estimatedMinutes(): number | null {
    return this.props.estimatedMinutes;
  }
  get timeLimitMs(): number {
    return this.props.timeLimitMs;
  }
  get memoryLimitKb(): number {
    return this.props.memoryLimitKb;
  }
  get authorId(): string | null {
    return this.props.authorId;
  }
  get contentRef(): string | null {
    return this.props.contentRef;
  }
  get tagIds(): string[] {
    return this.props.tagIds;
  }
  get forkedFromId(): string | null {
    return this.props.forkedFromId;
  }
  get rejectionReason(): string | null {
    return this.props.rejectionReason;
  }
  get publishedAt(): Date | null {
    return this.props.publishedAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * Đang chờ duyệt thì khoá sửa: cho sửa nghĩa là admin có thể duyệt một bản khác bản
   * họ đã đọc. Lối thoát là `withdraw()` — luôn đưa bài về `draft`.
   */
  get isLockedForReview(): boolean {
    return this.props.status === 'pending_review';
  }

  editMetadata(edit: ExerciseMetadataEdit): Result<true, InvalidInput | BusinessRuleViolation> {
    if (this.isLockedForReview) {
      return Result.fail(
        new BusinessRuleViolation('Bài đang chờ duyệt. Hủy gửi duyệt trước khi sửa.'),
      );
    }

    // Cùng lý do như tiêu đề: bài được tạo bằng tên tạm, không cho sửa slug thì slug
    // vô nghĩa nằm lại trong URL. Sau khi công khai thì đường dẫn đã phát ra ngoài.
    if (edit.slug !== undefined) {
      if (this.props.status === 'published') {
        return Result.fail(new BusinessRuleViolation('Bài đã công khai thì không đổi được slug'));
      }
      this.props.slug = edit.slug;
    }

    if (edit.title !== undefined) {
      const title = edit.title.trim();
      if (title.length === 0) return Result.fail(new InvalidInput('Tiêu đề không được để trống'));
      if (title.length > MAX_TITLE) {
        return Result.fail(new InvalidInput(`Tiêu đề tối đa ${MAX_TITLE} ký tự`));
      }
      this.props.title = title;
    }

    if (edit.summary !== undefined) this.props.summary = edit.summary?.trim() || null;
    if (edit.difficulty !== undefined) this.props.difficulty = edit.difficulty;

    if (edit.xpReward !== undefined) {
      if (!Number.isInteger(edit.xpReward) || edit.xpReward < 0) {
        return Result.fail(new InvalidInput('XP phải là số nguyên không âm', { xpReward: edit.xpReward }));
      }
      this.props.xpReward = edit.xpReward;
    }

    if (edit.estimatedMinutes !== undefined) {
      if (edit.estimatedMinutes !== null && edit.estimatedMinutes <= 0) {
        return Result.fail(new InvalidInput('Thời lượng ước tính phải lớn hơn 0'));
      }
      this.props.estimatedMinutes = edit.estimatedMinutes;
    }

    for (const field of ['timeLimitMs', 'memoryLimitKb'] as const) {
      const value = edit[field];
      if (value === undefined) continue;
      const { min, max } = LIMITS[field];
      if (!Number.isInteger(value) || value < min || value > max) {
        return Result.fail(new InvalidInput(`${field} phải nằm trong [${min}, ${max}]`, { [field]: value }));
      }
      this.props[field] = value;
    }

    if (edit.tagIds !== undefined) {
      // Bỏ trùng tại đây, không ở SQL: cùng một chủ đề gửi lên hai lần là lỗi của form,
      // và để nó chạm tới CSDL thì nhận về 23505 thay vì một danh sách đã sạch.
      const unique = [...new Set(edit.tagIds)];
      if (unique.length > MAX_TAGS) {
        return Result.fail(new InvalidInput(`Mỗi bài tối đa ${MAX_TAGS} chủ đề`));
      }
      this.props.tagIds = unique;
    }

    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /** Gọi sau khi document Mongo đã ghi xong — thứ tự đó là bắt buộc. */
  attachContent(contentRef: string): void {
    this.props.contentRef = contentRef;
    this.props.updatedAt = new Date();
  }

  /**
   * Gửi duyệt. Đi được từ `draft`, và từ hai trạng thái bị trả về — sửa xong gửi lại là
   * luồng bình thường, không phải trường hợp đặc biệt.
   */
  submit(): Result<true, BusinessRuleViolation> {
    // `published` nằm trong danh sách này để một bài đã lên sóng vẫn sửa được: tác giả lưu
    // bản chỉnh rồi gửi duyệt lại — bản cũ ẩn khỏi danh mục cho tới khi admin duyệt bản
    // mới, không lặng lẽ thay nội dung một bài đang công khai mà không ai xem lại.
    const allowed: ExerciseStatus[] = ['draft', 'changes_requested', 'rejected', 'published'];
    if (!allowed.includes(this.props.status)) {
      return Result.fail(
        new BusinessRuleViolation(`Không gửi duyệt được từ trạng thái ${this.props.status}`),
      );
    }
    if (this.props.contentRef === null) {
      return Result.fail(new BusinessRuleViolation('Bài chưa có nội dung'));
    }
    this.props.status = 'pending_review';
    // Lý do từ chối cũ thuộc về lần gửi trước; giữ lại sẽ hiển thị sai ở lần này.
    this.props.rejectionReason = null;
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /** Lối thoát khỏi trạng thái bị khoá. Chỉ từ `pending_review`. */
  /**
   * Huỷ gửi duyệt — LUÔN về `draft`, không bao giờ về `published`.
   * Cùng lý do đã ghi đầy đủ ở `Course.withdraw` bên learning-service.
   */
  withdraw(): Result<true, BusinessRuleViolation> {
    if (this.props.status !== 'pending_review') {
      return Result.fail(new BusinessRuleViolation('Bài không ở trạng thái chờ duyệt'));
    }
    this.props.status = 'draft';
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /**
   * Quyết định của admin. Bốn kết quả, không phải "duyệt / không duyệt":
   *
   *   approve           → published, ghi mốc công khai lần đầu
   *   request_changes   → changes_requested, tác giả sửa rồi gửi lại
   *   reject            → rejected, dứt khoát hơn nhưng vẫn gửi lại được
   *   archive           → archived, gỡ khỏi catalog
   *
   * `archive` đi từ `published`, `restore` từ `archived`, `approve` từ `pending_review`
   * hoặc từ một lần từ chối trước đó, còn `reject`/`request_changes` chỉ từ `pending_review`.
   */
  moderate(
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore' | 'revert',
    reason: string | null,
  ): Result<true, BusinessRuleViolation | InvalidInput> {
    /** Hoàn tác một quyết định vừa lỡ tay — xem chú thích đầy đủ ở `Course.moderate`. */
    if (decision === 'revert') {
      const revertible: ExerciseStatus[] = ['rejected', 'changes_requested', 'published'];
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
      return Result.ok(true);
    }

    if (decision === 'archive') {
      if (this.props.status !== 'published') {
        return Result.fail(new BusinessRuleViolation('Chỉ gỡ được bài đang công khai'));
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
      return Result.ok(true);
    }

    /**
     * Đường ra khỏi `archived`. Trước đây không có: `submit` chỉ nhận
     * `draft|changes_requested|rejected`, nên bài đã gỡ là gỡ vĩnh viễn và cách duy nhất
     * đưa lại là UPDATE thẳng vào CSDL — đi vòng qua đúng tầng sinh ra để chặn.
     *
     * Về `draft` chứ không thẳng `published`: bài bị gỡ có thể đã sai hoặc vi phạm, nên nó
     * đi lại vòng duyệt. `publishedAt` không đổi — `??=` ở nhánh `approve` đã lường trước
     * chuyện gỡ rồi duyệt lại, đây chỉ là bổ sung đoạn đường còn thiếu.
     */
    if (decision === 'restore') {
      if (this.props.status !== 'archived') {
        return Result.fail(
          new BusinessRuleViolation(`Chỉ khôi phục được bài đã gỡ (đang ${this.props.status})`),
        );
      }
      this.props.status = 'draft';
      this.props.rejectionReason = null;
      this.props.updatedAt = new Date();
      return Result.ok(true);
    }

    /**
     * `approve` đi được từ `rejected` và `changes_requested`, không riêng `pending_review`.
     *
     * Admin từ chối rồi nghĩ lại là chuyện có thật, và bài lúc đó vẫn đúng nguyên bản
     * họ vừa đọc — không có gì phải xem lại. Thiếu đường này thì cách duy nhất để sửa một
     * quyết định của admin là nhờ tác giả gửi lại, tức là bắt người ngoài chịu hậu quả của
     * cái nhấn nhầm.
     *
     * `reject` và `request_changes` thì vẫn chỉ từ `pending_review`: từ chối thứ chưa ai
     * gửi là trả lời một câu hỏi chưa được hỏi.
     */
    const allowed: ExerciseStatus[] =
      decision === 'approve'
        ? ['pending_review', 'rejected', 'changes_requested']
        : ['pending_review'];
    if (!allowed.includes(this.props.status)) {
      return Result.fail(
        new BusinessRuleViolation(
          decision === 'approve'
            ? `Bài không ở trạng thái duyệt được (đang ${this.props.status})`
            : `Bài không ở trạng thái chờ duyệt (đang ${this.props.status})`,
        ),
      );
    }

    if (decision === 'approve') {
      // Ràng buộc `exercises_published_needs_content` ở CSDL cũng chặn, nhưng ở đây
      // thông điệp nói được vì sao.
      if (this.props.contentRef === null) {
        return Result.fail(new BusinessRuleViolation('Bài chưa có nội dung, không công khai được'));
      }
      this.props.status = 'published';
      // Chỉ ghi lần đầu: gỡ rồi duyệt lại không phải là ngày phát hành mới.
      this.props.publishedAt ??= new Date();
      this.props.rejectionReason = null;
      this.props.updatedAt = new Date();
      return Result.ok(true);
    }

    // Từ chối mà không nói lý do thì tác giả không biết sửa gì.
    if (!reason?.trim()) {
      return Result.fail(new InvalidInput('Phải nêu lý do khi từ chối hoặc yêu cầu sửa'));
    }
    this.props.status = decision === 'reject' ? 'rejected' : 'changes_requested';
    this.props.rejectionReason = reason.trim();
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /** Chỉ bài đã công khai mới fork được — xem `codementor-content-model.md` §7. */
  get isForkable(): boolean {
    return this.props.visibility === 'public' && this.props.status === 'published';
  }

  /** Xoá được khi chưa từng công khai. CSDL vẫn chặn nếu còn chương tham chiếu. */
  get isDeletable(): boolean {
    return this.props.status !== 'published';
  }

  /** Đang chờ admin duyệt yêu cầu xin gỡ — xem chú thích cùng tên ở `Course` (learning-service). */
  get removalRequested(): boolean {
    return this.props.status === 'published' && this.props.rejectionReason !== null;
  }

  /** Tác giả xin gỡ bài đang công khai của mình. */
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

  /** Admin từ chối yêu cầu xin gỡ — bài không đổi gì, chỉ xoá nguyện vọng đang chờ. */
  denyRemoval(): Result<true, BusinessRuleViolation> {
    if (!this.removalRequested) {
      return Result.fail(new BusinessRuleViolation('Không có yêu cầu xin gỡ nào đang chờ'));
    }
    this.props.rejectionReason = null;
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }
}
