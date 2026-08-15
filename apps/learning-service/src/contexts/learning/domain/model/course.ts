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
}

const MAX_TITLE = 200;
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
        progressionMode: 'graph',
        status: 'draft',
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
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isLockedForReview(): boolean {
    return this.props.status === 'pending_review';
  }

  get isDeletable(): boolean {
    return this.props.status !== 'published';
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

  submit(curriculum: {
    chapters: { lessonCount: number }[];
    lessonsMissingContent: number;
    exercisesNotUsable: number;
  }): Result<true, BusinessRuleViolation> {
    const allowed: ContentStatus[] = ['draft', 'changes_requested', 'rejected'];
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

    this.props.status = 'pending_review';
    this.props.rejectionReason = null;
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }

  withdraw(): Result<true, BusinessRuleViolation> {
    if (this.props.status !== 'pending_review') {
      return Result.fail(new BusinessRuleViolation('Khóa học không ở trạng thái chờ duyệt'));
    }
    this.props.status = 'draft';
    this.props.updatedAt = new Date();
    return Result.ok(true);
  }
}
