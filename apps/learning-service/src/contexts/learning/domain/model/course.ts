import { AggregateRoot, BusinessRuleViolation, InvalidInput, Result } from '@codementor/kernel';
import type { ContentStatus, CurrentLevel, ProgressionMode } from './roadmap';

interface CourseProps {
  slug: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  level: CurrentLevel;
  durationHours: number | null;
  instructorId: string | null;
  prerequisiteNote: string | null;
  progressionMode: ProgressionMode;
  status: ContentStatus;
  createdBy: string | null;
  rejectionReason: string | null;
  publishedAt: Date | null;
  /** Do trigger `trg_chapters_curriculum_count` giữ. Chỉ đọc. */
  totalChapters: number;
  /** Do trigger `trg_lessons_curriculum_count` giữ. Chỉ đọc. */
  totalLessons: number;
  /** Chủ đề tác giả tự gắn (`course_tags`). Chủ đề của bài tập bên trong KHÔNG nằm ở đây. */
  tagIds: string[];
  updatedAt: Date;
}

export interface CourseEdit {
  slug?: string;
  title?: string;
  description?: string | null;
  coverImageUrl?: string | null;
  level?: CurrentLevel;
  instructorId?: string | null;
  prerequisiteNote?: string | null;
  progressionMode?: ProgressionMode;
  /** Thay TOÀN BỘ danh sách chủ đề. Mảng rỗng = gỡ hết, vắng mặt = giữ nguyên. */
  tagIds?: string[];
}

const MAX_TITLE = 200;

/** Cùng trần với bài tập: quá số này thì chủ đề hết còn phân biệt được gì. */
const MAX_TAGS = 8;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/;

function checkImageUrl(raw: string): InvalidInput | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new InvalidInput('Địa chỉ ảnh không hợp lệ', { coverImageUrl: raw });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new InvalidInput('Địa chỉ ảnh phải bắt đầu bằng http:// hoặc https://');
  }
  return null;
}

/**
 * Khóa học — metadata. Chương và bài KHÔNG nằm trong aggregate này: chúng được ghi cả
 * cây trong một transaction qua repository, vì sửa từng dòng sẽ đụng
 * `UNIQUE(chapter_id, position)` giữa chừng.
 *
 * `total_chapters` và `total_lessons` chỉ có getter, không có setter. Hai cột đó do
 * trigger ở migration 0012 giữ; ghi tay là tự chuốc lấy số lệch.
 */
export class Course extends AggregateRoot<string> {
  private constructor(
    id: string,
    private props: CourseProps,
  ) {
    super(id);
  }

  static rehydrate(id: string, props: CourseProps): Course {
    return new Course(id, props);
  }

  static create(params: {
    id: string;
    slug: string;
    title: string;
    level: CurrentLevel;
    createdBy: string;
  }): Result<Course, InvalidInput> {
    const title = params.title.trim();
    if (title.length === 0) return Result.fail(new InvalidInput('Tiêu đề không được để trống'));
    if (title.length > MAX_TITLE) {
      return Result.fail(new InvalidInput(`Tiêu đề tối đa ${MAX_TITLE} ký tự`));
    }

    return Result.ok(
      new Course(params.id, {
        slug: params.slug,
        title,
        description: null,
        coverImageUrl: null,
        level: params.level,
        durationHours: null,
        // Mặc định người soạn cũng là người đứng lớp; form metadata cho đổi.
        instructorId: params.createdBy,
        prerequisiteNote: null,
        // `linear`, not `graph`: graph mode evaluates prerequisite edges, and nothing
        // authors them yet — a new course would open with every lesson locked. Order is a
        // gate every course already has. Switch the default back when the studio can draw
        // the dependency graph.
        progressionMode: 'linear',
        status: 'draft',
        tagIds: [],
        createdBy: params.createdBy,
        rejectionReason: null,
        publishedAt: null,
        totalChapters: 0,
        totalLessons: 0,
        updatedAt: new Date(),
      }),
    );
  }

  get slug(): string {
    return this.props.slug;
  }
  get title(): string {
    return this.props.title;
  }
  get description(): string | null {
    return this.props.description;
  }
  get coverImageUrl(): string | null {
    return this.props.coverImageUrl;
  }
  get level(): CurrentLevel {
    return this.props.level;
  }
  get durationHours(): number | null {
    return this.props.durationHours;
  }
  get instructorId(): string | null {
    return this.props.instructorId;
  }
  get prerequisiteNote(): string | null {
    return this.props.prerequisiteNote;
  }
  get progressionMode(): ProgressionMode {
    return this.props.progressionMode;
  }
  get status(): ContentStatus {
    return this.props.status;
  }
  get createdBy(): string | null {
    return this.props.createdBy;
  }
  get rejectionReason(): string | null {
    return this.props.rejectionReason;
  }
  get publishedAt(): Date | null {
    return this.props.publishedAt;
  }
  get totalChapters(): number {
    return this.props.totalChapters;
  }
  get totalLessons(): number {
    return this.props.totalLessons;
  }
  get tagIds(): string[] {
    return this.props.tagIds;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isLockedForReview(): boolean {
    return this.props.status === 'pending_review';
  }

  get isDeletable(): boolean {
    return this.props.status !== 'published';
  }

  /**
   * Đang chờ admin duyệt yêu cầu xin gỡ — KHÔNG phải một trạng thái riêng, mượn tạm ô
   * `rejectionReason`: ô này luôn rỗng khi đang `published` (chỉ có giá trị ở
   * `rejected`/`changes_requested`/`archived`), nên "published + có rejectionReason"
   * không đụng ngữ nghĩa nào khác mà không cần thêm cột hay giá trị enum mới.
   */
  get removalRequested(): boolean {
    return this.props.status === 'published' && this.props.rejectionReason !== null;
  }

  edit(edit: CourseEdit): Result<true, InvalidInput | BusinessRuleViolation> {
    if (this.isLockedForReview) {
      return Result.fail(
        new BusinessRuleViolation('Khóa học đang chờ duyệt. Hủy gửi duyệt trước khi sửa.'),
      );
    }

    if (edit.slug !== undefined) {
      if (this.props.status === 'published') {
        return Result.fail(
          new BusinessRuleViolation('Khóa học đã công khai thì không đổi được slug'),
        );
      }
      const slug = edit.slug.trim().toLowerCase();
      if (!SLUG_PATTERN.test(slug)) {
        return Result.fail(
          new InvalidInput(
            'Slug phải dài 3–80 ký tự, chỉ gồm chữ thường, số và gạch ngang, không bắt đầu/kết thúc bằng gạch',
            { slug: edit.slug },
          ),
        );
      }
      this.props.slug = slug;
    }

    if (edit.title !== undefined) {
      const title = edit.title.trim();
      if (title.length === 0) return Result.fail(new InvalidInput('Tiêu đề không được để trống'));
      if (title.length > MAX_TITLE) {
        return Result.fail(new InvalidInput(`Tiêu đề tối đa ${MAX_TITLE} ký tự`));
      }
      this.props.title = title;
    }

    if (edit.coverImageUrl !== undefined) {
      const trimmed = edit.coverImageUrl?.trim() || null;
      if (trimmed) {
        const invalid = checkImageUrl(trimmed);
        if (invalid) return Result.fail(invalid);
      }
      this.props.coverImageUrl = trimmed;
    }

    if (edit.description !== undefined) this.props.description = edit.description?.trim() || null;
    if (edit.prerequisiteNote !== undefined) {
      this.props.prerequisiteNote = edit.prerequisiteNote?.trim() || null;
    }
    if (edit.level !== undefined) this.props.level = edit.level;
    if (edit.instructorId !== undefined) this.props.instructorId = edit.instructorId;
    if (edit.progressionMode !== undefined) this.props.progressionMode = edit.progressionMode;

    if (edit.tagIds !== undefined) {
      // Bỏ trùng tại đây: cùng một chủ đề gửi lên hai lần là lỗi của form, để nó chạm tới
      // CSDL thì nhận về 23505 thay vì một danh sách đã sạch.
      const unique = [...new Set(edit.tagIds)];
      if (unique.length > MAX_TAGS) {
        return Result.fail(new InvalidInput(`Mỗi khóa học tối đa ${MAX_TAGS} chủ đề`));
      }
      this.props.tagIds = unique;
    }

    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /**
   * Tổng thời lượng, tính từ bài học. Cột là số nguyên GIỜ và có CHECK `> 0`, nên một
   * khóa 20 phút vẫn phải làm tròn LÊN thành 1 giờ — làm tròn xuống ra 0 và bị CSDL từ chối.
   */
  recalculateDurationHours(lessonMinutes: (number | null)[]): void {
    const minutes = lessonMinutes.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    this.props.durationHours = minutes > 0 ? Math.ceil(minutes / 60) : null;
    this.props.updatedAt = new Date();
  }

  submit(
    curriculum: {
      chapters: { lessonCount: number }[];
      lessonsMissingContent: number;
      exercisesNotUsable: number;
    },
    /** Ghi chú gửi người duyệt — bắt buộc ở lần gửi LẠI, xem `requiresSubmitNote`. */
    note?: string | null,
  ): Result<true, BusinessRuleViolation | InvalidInput> {
    // `published` nằm trong danh sách này để một khoá đã lên sóng vẫn sửa được: tác giả
    // lưu bản chỉnh, rồi gửi duyệt lại — bản cũ ẩn khỏi danh mục cho tới khi admin duyệt
    // bản mới, không lặng lẽ thay nội dung một khoá học đang công khai mà không ai xem lại.
    const allowed: ContentStatus[] = ['draft', 'changes_requested', 'rejected', 'published'];
    if (!allowed.includes(this.props.status)) {
      return Result.fail(
        new BusinessRuleViolation(`Không gửi duyệt được từ trạng thái ${this.props.status}`),
      );
    }

    const missing: string[] = [];
    if (curriculum.chapters.length === 0) missing.push('tối thiểu một chương');

    const emptyChapters = curriculum.chapters.filter((chapter) => chapter.lessonCount === 0).length;
    if (emptyChapters > 0) missing.push(`${emptyChapters} chương chưa có bài nào`);

    if (curriculum.lessonsMissingContent > 0) {
      missing.push(`${curriculum.lessonsMissingContent} bài lý thuyết chưa có nội dung`);
    }

    // Bài code chưa công khai của NGƯỜI KHÁC thì học viên sẽ mở ra không thấy gì.
    if (curriculum.exercisesNotUsable > 0) {
      missing.push(
        `${curriculum.exercisesNotUsable} bài code chưa công khai và không phải của bạn`,
      );
    }

    if (!this.props.description?.trim()) missing.push('mô tả');

    if (missing.length > 0) {
      return Result.fail(
        new BusinessRuleViolation(`Chưa gửi duyệt được, còn thiếu: ${missing.join('; ')}`, {
          missing,
        }),
      );
    }

    const trimmed = note?.trim() || null;
    if (this.requiresSubmitNote && trimmed === null) {
      return Result.fail(
        new InvalidInput('Gửi duyệt lại phải kèm ghi chú cho người duyệt biết bạn đã sửa gì'),
      );
    }

    this.props.status = 'pending_review';
    // Ô `rejection_reason` mang nghĩa thứ ba ở đây: trong lúc `pending_review` nó là GHI
    // CHÚ CỦA TÁC GIẢ, không phải lời chê của admin. Ba nghĩa trên một cột là cái giá để
    // không phải thêm cột, và nó an toàn vì ba nghĩa không bao giờ cùng tồn tại: mỗi nghĩa
    // gắn với đúng một trạng thái (`pending_review`, `rejected`/`changes_requested`,
    // `published` + xin gỡ). Đọc qua `submitNote` chứ đừng đọc thẳng.
    this.props.rejectionReason = trimmed;
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /**
   * Gửi LẠI thì phải nói đã sửa gì. Lần gửi đầu từ bản nháp thì không — lúc đó chưa có
   * quyết định nào để giải thích, và bắt viết ghi chú chỉ là một ô trống phải điền.
   */
  get requiresSubmitNote(): boolean {
    return this.props.status !== 'draft';
  }

  /** Ghi chú tác giả gửi kèm lần duyệt này. Chỉ có nghĩa khi đang chờ duyệt. */
  get submitNote(): string | null {
    return this.props.status === 'pending_review' ? this.props.rejectionReason : null;
  }

  /**
   * Quyết định của admin. Xem `Exercise.moderate` — cùng máy trạng thái, khác enum:
   * `content_status` không có `hidden`, nên tác giả tự gỡ cũng đi qua `archived`.
   */
  moderate(
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore' | 'revert',
    reason: string | null,
  ): Result<true, BusinessRuleViolation | InvalidInput> {
    /**
     * Hoàn tác một quyết định vừa lỡ tay — đưa nội dung TRỞ LẠI hàng chờ, không xoá gì.
     *
     * Ba đường vào, và cả ba đều là "tôi bấm nhầm nút":
     *   rejected / changes_requested → pending_review   (lỡ từ chối)
     *   published                    → pending_review   (lỡ duyệt)
     *
     * KHÔNG dùng `archived`: gỡ một nội dung đang công khai là một quyết định vận hành có
     * lý do bắt buộc và có thông báo gửi tác giả, còn đây là sửa một cú nhấn. Đường ra
     * khỏi `archived` vẫn là `restore`.
     *
     * `rejectionReason` bị xoá: lý do cũ gắn với quyết định vừa được rút lại, để nó ở lại
     * thì tác giả mở ra vẫn đọc thấy một lời chê không còn hiệu lực. Dấu vết của cả hai
     * lần bấm nằm ở `audit_logs`, nơi không bao giờ bị ghi đè.
     *
     * `publishedAt` giữ nguyên — xem `withdraw`.
     */
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
      return Result.ok(true);
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
      return Result.ok(true);
    }

    /**
     * Đường ra khỏi `archived` — trước đây không có, và đó là bẫy chứ không phải luật:
     * với `content_status` thì tác giả tự gỡ cũng rơi vào `archived`, nên "gỡ" mà không
     * bật lại được nghĩa là mọi lần gỡ đều vĩnh viễn. Khôi phục xong phải cứu bằng UPDATE
     * thẳng vào CSDL, tức là đi vòng qua đúng tầng sinh ra để chặn điều đó.
     *
     * Về `draft`, KHÔNG về thẳng `published`: nội dung bị gỡ có thể đã sai hoặc vi phạm,
     * nên nó đi lại quy trình duyệt như mọi bản nháp khác. `publishedAt` giữ nguyên ngày
     * phát hành đầu tiên — xem `moderate` ở nhánh `approve`.
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
      return Result.ok(true);
    }

    /**
     * `approve` đi được từ `rejected` và `changes_requested`, không riêng `pending_review`.
     *
     * Admin từ chối rồi nghĩ lại là chuyện có thật, và khóa học lúc đó vẫn đúng nguyên bản
     * họ vừa đọc — không có gì phải xem lại. Thiếu đường này thì cách duy nhất để sửa một
     * quyết định của admin là nhờ tác giả gửi lại, tức là bắt người ngoài chịu hậu quả của
     * cái nhấn nhầm.
     *
     * `reject` và `request_changes` thì vẫn chỉ từ `pending_review`: từ chối thứ chưa ai
     * gửi là trả lời một câu hỏi chưa được hỏi.
     */
    const allowed: ContentStatus[] =
      decision === 'approve'
        ? ['pending_review', 'rejected', 'changes_requested']
        : ['pending_review'];
    if (!allowed.includes(this.props.status)) {
      return Result.fail(
        new BusinessRuleViolation(
          decision === 'approve'
            ? `Khóa học không ở trạng thái duyệt được (đang ${this.props.status})`
            : `Khóa học không ở trạng thái chờ duyệt (đang ${this.props.status})`,
        ),
      );
    }

    if (decision === 'approve') {
      this.props.status = 'published';
      this.props.publishedAt ??= new Date();
      this.props.rejectionReason = null;
      this.props.updatedAt = new Date();
      return Result.ok(true);
    }

    if (!reason?.trim()) {
      return Result.fail(new InvalidInput('Phải nêu lý do khi từ chối hoặc yêu cầu sửa'));
    }
    this.props.status = decision === 'reject' ? 'rejected' : 'changes_requested';
    this.props.rejectionReason = reason.trim();
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /**
   * Tác giả xin gỡ khóa học đang công khai của mình — KHÔNG tự gỡ được nữa, chỉ ghi lại
   * nguyện vọng kèm lý do. Trạng thái giữ nguyên `published`, học viên vẫn học bình
   * thường cho tới khi admin quyết (`moderate('archive', ...)` để duyệt, `denyRemoval()`
   * để từ chối) — xem `removalRequested`.
   */
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

  /** Admin từ chối yêu cầu xin gỡ — khóa học không đổi gì, chỉ xoá nguyện vọng đang chờ. */
  denyRemoval(): Result<true, BusinessRuleViolation> {
    if (!this.removalRequested) {
      return Result.fail(new BusinessRuleViolation('Không có yêu cầu xin gỡ nào đang chờ'));
    }
    this.props.rejectionReason = null;
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /**
   * Huỷ gửi duyệt — LUÔN về `draft`, không bao giờ về `published`.
   *
   * Trước đây dòng này là `publishedAt !== null ? 'published' : 'draft'`, với ý "huỷ một
   * lần gửi lại thì trả khoá đang sống về chỗ cũ". Hai chỗ hỏng:
   *
   * 1. `publishedAt` là mốc công khai LẦN ĐẦU và không bao giờ bị xoá — `moderate('archive')`
   *    rồi `moderate('restore')` giữ nguyên nó. Nên một khoá đã bị gỡ, đưa về nháp, sửa,
   *    gửi duyệt rồi huỷ gửi sẽ TỰ CÔNG KHAI TRỞ LẠI. Không ai duyệt gì cả.
   * 2. Ngay cả đường "sửa khoá đang sống" cũng sai: `edit()` ghi thẳng lên hàng đang
   *    published, nên quay về `published` là đẩy bản vừa sửa ra cho học viên mà không qua
   *    một lượt duyệt nào — đúng thứ mà bước gửi duyệt sinh ra để chặn.
   *
   * `publishedAt` giữ nguyên nên khoá vẫn "đã từng công khai": gửi duyệt lại và được duyệt
   * là nó trở lại danh mục với đúng ngày phát hành đầu tiên.
   */
  withdraw(): Result<true, BusinessRuleViolation> {
    if (this.props.status !== 'pending_review') {
      return Result.fail(new BusinessRuleViolation('Khóa học không ở trạng thái chờ duyệt'));
    }
    this.props.status = 'draft';
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }
}
