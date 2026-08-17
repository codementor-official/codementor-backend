import { AggregateRoot, BusinessRuleViolation, InvalidInput, Result } from '@codementor/kernel';

/** Khớp enum `content_status` sau migration 0018. */
export type ContentStatus =
  | 'draft'
  | 'pending_review'
  | 'changes_requested'
  | 'rejected'
  | 'published'
  | 'archived';

export type RoadmapField =
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'mobile'
  | 'data_ai'
  | 'foundation';

export type CurrentLevel = 'none' | 'basic' | 'intermediate' | 'experienced';
export type ProgressionMode = 'linear' | 'graph' | 'free';

interface RoadmapProps {
  slug: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  field: RoadmapField;
  level: CurrentLevel;
  coverImageUrl: string | null;
  estimatedHours: number | null;
  progressionMode: ProgressionMode;
  prerequisiteNote: string | null;
  status: ContentStatus;
  createdBy: string | null;
  rejectionReason: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
}

export interface RoadmapEdit {
  slug?: string;
  title?: string;
  shortDescription?: string | null;
  description?: string | null;
  field?: RoadmapField;
  level?: CurrentLevel;
  coverImageUrl?: string | null;
  progressionMode?: ProgressionMode;
  prerequisiteNote?: string | null;
}

const MAX_TITLE = 200;
const MIN_COURSES_TO_SUBMIT = 2;

/** Chỉ http/https — `javascript:` ở ô ảnh bìa là stored XSS chỗ render. */
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
 * Lộ trình học — tập khóa học có thứ tự.
 *
 * `estimated_hours` KHÔNG do người dùng nhập: nó là tổng `duration_hours` của các khóa
 * học thành phần, tính lại sau mỗi lần ghi danh sách. Cho sửa tay thì con số hiển thị
 * sẽ lệch khỏi nội dung thật ngay lần đầu ai đó thêm một khóa.
 */
export class Roadmap extends AggregateRoot<string> {
  private constructor(
    id: string,
    private props: RoadmapProps,
  ) {
    super(id);
  }

  static rehydrate(id: string, props: RoadmapProps): Roadmap {
    return new Roadmap(id, props);
  }

  static create(params: {
    id: string;
    slug: string;
    title: string;
    field: RoadmapField;
    level: CurrentLevel;
    createdBy: string;
  }): Result<Roadmap, InvalidInput> {
    const title = params.title.trim();
    if (title.length === 0) return Result.fail(new InvalidInput('Tiêu đề không được để trống'));
    if (title.length > MAX_TITLE) {
      return Result.fail(new InvalidInput(`Tiêu đề tối đa ${MAX_TITLE} ký tự`));
    }

    return Result.ok(
      new Roadmap(params.id, {
        slug: params.slug,
        title,
        shortDescription: null,
        description: null,
        field: params.field,
        level: params.level,
        coverImageUrl: null,
        estimatedHours: null,
        progressionMode: 'graph',
        prerequisiteNote: null,
        status: 'draft',
        createdBy: params.createdBy,
        rejectionReason: null,
        publishedAt: null,
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
  get shortDescription(): string | null {
    return this.props.shortDescription;
  }
  get description(): string | null {
    return this.props.description;
  }
  get field(): RoadmapField {
    return this.props.field;
  }
  get level(): CurrentLevel {
    return this.props.level;
  }
  get coverImageUrl(): string | null {
    return this.props.coverImageUrl;
  }
  get estimatedHours(): number | null {
    return this.props.estimatedHours;
  }
  get progressionMode(): ProgressionMode {
    return this.props.progressionMode;
  }
  get prerequisiteNote(): string | null {
    return this.props.prerequisiteNote;
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
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isLockedForReview(): boolean {
    return this.props.status === 'pending_review';
  }

  get isDeletable(): boolean {
    return this.props.status !== 'published';
  }

  edit(edit: RoadmapEdit): Result<true, InvalidInput | BusinessRuleViolation> {
    if (this.isLockedForReview) {
      return Result.fail(
        new BusinessRuleViolation('Lộ trình đang chờ duyệt. Hủy gửi duyệt trước khi sửa.'),
      );
    }

    // Đổi slug sau khi công khai là làm hỏng mọi đường dẫn đã phát ra ngoài. Trước đó
    // thì phải cho sửa: lộ trình được tạo bằng tiêu đề tạm, và nếu không sửa được thì
    // slug vô nghĩa đó nằm lại trong URL vĩnh viễn.
    if (edit.slug !== undefined) {
      if (this.props.status === 'published') {
        return Result.fail(
          new BusinessRuleViolation('Lộ trình đã công khai thì không đổi được slug'),
        );
      }
      const slug = edit.slug.trim().toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/.test(slug)) {
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

    if (edit.shortDescription !== undefined) {
      this.props.shortDescription = edit.shortDescription?.trim() || null;
    }
    if (edit.description !== undefined) this.props.description = edit.description?.trim() || null;
    if (edit.prerequisiteNote !== undefined) {
      this.props.prerequisiteNote = edit.prerequisiteNote?.trim() || null;
    }
    if (edit.field !== undefined) this.props.field = edit.field;
    if (edit.level !== undefined) this.props.level = edit.level;
    if (edit.progressionMode !== undefined) this.props.progressionMode = edit.progressionMode;

    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  /** Tổng hợp từ khóa học con — gọi sau mỗi lần ghi danh sách, không nhận từ người dùng. */
  recalculateEstimatedHours(courseHours: (number | null)[]): void {
    const total = courseHours.reduce<number>((sum, hours) => sum + (hours ?? 0), 0);
    // Cột có CHECK `> 0`, nên tổng bằng 0 phải là NULL chứ không phải 0.
    this.props.estimatedHours = total > 0 ? total : null;
    this.props.updatedAt = new Date();
  }

  /**
   * Gửi duyệt. Lộ trình chứa khóa học chưa công khai thì học viên sẽ gặp lỗ hổng giữa
   * đường, nên điều kiện này kiểm cả nội dung con chứ không chỉ chính nó.
   */
  submit(courses: { status: ContentStatus }[]): Result<true, BusinessRuleViolation> {
    const allowed: ContentStatus[] = ['draft', 'changes_requested', 'rejected'];
    if (!allowed.includes(this.props.status)) {
      return Result.fail(
        new BusinessRuleViolation(`Không gửi duyệt được từ trạng thái ${this.props.status}`),
      );
    }

    const missing: string[] = [];
    if (courses.length < MIN_COURSES_TO_SUBMIT) {
      missing.push(`tối thiểu ${MIN_COURSES_TO_SUBMIT} khóa học (đang có ${courses.length})`);
    }
    const unpublished = courses.filter((course) => course.status !== 'published').length;
    if (unpublished > 0) {
      missing.push(`${unpublished} khóa học chưa được công khai`);
    }
    if (!this.props.description?.trim()) missing.push('mô tả');

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
   * Quyết định của admin. Xem `Exercise.moderate` — cùng máy trạng thái, khác enum:
   * `content_status` không có `hidden`, nên tác giả tự gỡ cũng đi qua `archived`.
   */
  moderate(
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore',
    reason: string | null,
  ): Result<true, BusinessRuleViolation | InvalidInput> {
    if (decision === 'archive') {
      if (this.props.status !== 'published') {
        return Result.fail(new BusinessRuleViolation('Chỉ gỡ được nội dung đang công khai'));
      }
      this.props.status = 'archived';
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

    if (this.props.status !== 'pending_review') {
      return Result.fail(
        new BusinessRuleViolation(
          `Lộ trình không ở trạng thái chờ duyệt (đang ${this.props.status})`,
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

  withdraw(): Result<true, BusinessRuleViolation> {
    if (this.props.status !== 'pending_review') {
      return Result.fail(new BusinessRuleViolation('Lộ trình không ở trạng thái chờ duyệt'));
    }
    this.props.status = 'draft';
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }
}
