import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { AlreadyExists, BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { DEFAULT_PAGE_LIMIT, canEditCourse, decodeCursor, requireHumanId, toPage, ContentAuthorLookup, type AuthenticatedUser, type Page } from '@codementor/platform';
import { Course } from '../domain/model/course';
import type { CourseEdit } from '../domain/model/course';
import { validateCurriculum, type ChapterDraft } from '../domain/model/curriculum';
import type { CurrentLevel } from '../domain/model/roadmap';
import {
  COURSE_REPOSITORY,
  LESSON_CONTENT_REPOSITORY,
  type CourseListItem,
  type CourseRepository,
  type LessonContent,
  type LessonContentRepository,
  type StoredChapter,
} from '../domain/port/course.repository';

export interface ListCoursesQuery {
  level?: string;
  status?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CourseView {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  level: string;
  durationHours: number | null;
  instructorId: string | null;
  prerequisiteNote: string | null;
  progressionMode: string;
  status: string;
  createdBy: string | null;
  rejectionReason: string | null;
  publishedAt: string | null;
  totalChapters: number;
  totalLessons: number;
  updatedAt: string;
  chapters?: StoredChapter[];
}

function toView(course: Course, chapters?: StoredChapter[]): CourseView {
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    coverImageUrl: course.coverImageUrl,
    level: course.level,
    durationHours: course.durationHours,
    instructorId: course.instructorId,
    prerequisiteNote: course.prerequisiteNote,
    progressionMode: course.progressionMode,
    status: course.status,
    createdBy: course.createdBy,
    rejectionReason: course.rejectionReason,
    publishedAt: course.publishedAt?.toISOString() ?? null,
    totalChapters: course.totalChapters,
    totalLessons: course.totalLessons,
    updatedAt: course.updatedAt.toISOString(),
    ...(chapters !== undefined ? { chapters } : {}),
  };
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
  const stem = base.length >= 3 ? base : `khoa-hoc-${Date.now().toString(36)}`;
  return suffix ? `${stem}-${suffix}` : stem;
}

@Injectable()
export class CourseUseCases {
  private readonly logger = new Logger(CourseUseCases.name);

  constructor(
    @Inject(COURSE_REPOSITORY) private readonly courses: CourseRepository,
    @Inject(LESSON_CONTENT_REPOSITORY) private readonly contents: LessonContentRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
    private readonly authors: ContentAuthorLookup,
  ) {}

  async list(
    scope: { createdBy: string } | { publishedOnly: true } | { pendingOnly: true },
    query: ListCoursesQuery,
  ): Promise<Page<CourseListItem>> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), 100);
    // Xem chú thích ở `ListExercisesUseCase`: admin phải tìm lại được khoá đã duyệt
    // hoặc đã từ chối, nếu không thì không có đường lùi cho một quyết định lỡ tay.
    const status = 'publishedOnly' in scope ? undefined : query.status;
    const rows = await this.courses.list({
      createdBy: 'createdBy' in scope ? scope.createdBy : null,
      publishedOnly: 'publishedOnly' in scope,
      pendingOnly: 'pendingOnly' in scope && status === undefined,
      level: query.level,
      status,
      q: query.q,
      limit,
      cursor: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
    });
    return toPage(rows, limit);
  }

  async get(user: AuthenticatedUser, id: string): Promise<CourseView> {
    const course = await this.mustFind(id);
    if (course.status !== 'published' && !canEditCourse(user, { created_by: course.createdBy })) {
      throw new NotFound('Khóa học', id);
    }
    return toView(course, await this.courses.findCurriculum(id));
  }

  async create(
    user: AuthenticatedUser,
    input: { title: string; level: CurrentLevel; slug?: string },
  ): Promise<CourseView> {
    const slug = await this.freeSlug(input.slug, input.title);
    const course = Course.create({
      id: randomUUID(),
      slug,
      title: input.title,
      level: input.level,
      createdBy: requireHumanId(user),
    });
    if (course.isFail) throw course.error;

    await this.courses.save(course.value);
    return toView(course.value, []);
  }

  async update(user: AuthenticatedUser, id: string, edit: CourseEdit): Promise<CourseView> {
    const course = await this.mustOwn(user, id);

    if (edit.slug !== undefined && edit.slug !== course.slug) {
      if (await this.courses.existsBySlug(edit.slug)) {
        throw new AlreadyExists('Slug', { slug: edit.slug });
      }
    }

    const updated = course.edit(edit);
    if (updated.isFail) throw updated.error;

    await this.courses.save(course);
    return toView(course, await this.courses.findCurriculum(id));
  }

  /**
   * Ghi cả cây chương + bài, rồi tính lại thời lượng khóa học.
   *
   * Kiểm cây TRƯỚC khi chạm CSDL: transaction này dài, để ràng buộc bắt lỗi thì thông
   * điệp trả về là tên constraint chứ không nói được chương nào bài nào.
   */
  async saveCurriculum(
    user: AuthenticatedUser,
    id: string,
    chapters: ChapterDraft[],
  ): Promise<CourseView> {
    const course = await this.mustOwn(user, id);
    if (course.isLockedForReview) {
      throw new BusinessRuleViolation('Khóa học đang chờ duyệt. Hủy gửi duyệt trước khi sửa.');
    }

    const valid = validateCurriculum(chapters);
    if (valid.isFail) throw valid.error;

    await this.courses.saveCurriculum(id, chapters);

    const saved = await this.courses.findCurriculum(id);
    course.recalculateDurationHours(
      saved.flatMap((chapter) => chapter.lessons.map((lesson) => lesson.durationMinutes)),
    );
    await this.courses.save(course);

    // Đọc lại thay vì trả bản trong bộ nhớ: `total_chapters` và `total_lessons` do
    // trigger giữ, nên aggregate nạp TRƯỚC lệnh ghi vẫn mang số cũ. Trả nó về là nói
    // với studio rằng khóa học không có chương nào, ngay sau khi vừa lưu hai chương.
    const refreshed = await this.mustFind(id);
    return toView(refreshed, saved);
  }

  async saveLessonContent(
    user: AuthenticatedUser,
    courseId: string,
    lessonId: string,
    content: LessonContent,
  ): Promise<LessonContent> {
    const course = await this.mustOwn(user, courseId);
    if (course.isLockedForReview) {
      throw new BusinessRuleViolation('Khóa học đang chờ duyệt. Hủy gửi duyệt trước khi sửa.');
    }

    // Bài phải thuộc đúng khóa học này — nếu không, ai sở hữu một khóa học là ghi được
    // nội dung vào bài của khóa học bất kỳ, chỉ cần đoán đúng id.
    const curriculum = await this.courses.findCurriculum(courseId);
    const lesson = curriculum
      .flatMap((chapter) => chapter.lessons)
      .find((candidate) => candidate.id === lessonId);
    if (!lesson) throw new NotFound('Bài học', lessonId);

    // Document trước, tham chiếu sau — cùng thứ tự như thân bài code.
    const contentRef = await this.contents.upsert(lessonId, content);
    if (lesson.contentRef !== contentRef) {
      await this.courses.setLessonContentRef(lessonId, contentRef);
    }
    return content;
  }

  async getLessonContent(
    user: AuthenticatedUser,
    courseId: string,
    lessonId: string,
  ): Promise<LessonContent | null> {
    await this.get(user, courseId);
    return this.contents.findByLessonId(lessonId);
  }

  async submit(user: AuthenticatedUser, id: string): Promise<CourseView> {
    const course = await this.mustOwn(user, id);
    const curriculum = await this.courses.findCurriculum(id);

    const lessons = curriculum.flatMap((chapter) => chapter.lessons);
    // Bài lý thuyết chưa có `content_ref` là ô rỗng với học viên.
    const lessonsMissingContent = lessons.filter(
      (lesson) => !lesson.exerciseId && lesson.contentRef === null,
    ).length;
    // Bài code chưa công khai mà không phải của mình thì học viên mở ra không thấy gì.
    const exercisesNotUsable = lessons.filter(
      (lesson) =>
        lesson.exerciseId !== null &&
        lesson.exerciseStatus !== 'published' &&
        lesson.exerciseAuthorId !== course.createdBy,
    ).length;

    const submitted = course.submit({
      chapters: curriculum.map((chapter) => ({ lessonCount: chapter.lessons.length })),
      lessonsMissingContent,
      exercisesNotUsable,
    });
    if (submitted.isFail) throw submitted.error;

    await this.courses.save(course);
    // Người nhận là ADMIN, không phải người học: khoá học vẫn là bản nháp cho tới khi
    // được duyệt. Thất bại ở đây chỉ ghi log — xem `announcePublished` cho lý do đầy đủ.
    try {
      await this.eventBus.publish(TOPICS.CONTENT_REVIEW_REQUESTED, {
        kind: 'COURSE',
        contentId: course.id,
        slug: course.slug,
        title: course.title,
        authorName: user.displayName,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_REVIEW_REQUESTED} cho ${course.id}`,
        error as Error,
      );
    }
    return toView(course, curriculum);
  }

  async withdraw(user: AuthenticatedUser, id: string): Promise<CourseView> {
    const course = await this.mustOwn(user, id);
    const withdrawn = course.withdraw();
    if (withdrawn.isFail) throw withdrawn.error;

    await this.courses.save(course);
    return toView(course, await this.courses.findCurriculum(id));
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const course = await this.mustOwn(user, id);
    if (!course.isDeletable) {
      throw new BusinessRuleViolation(
        'Khóa học đã công khai không xoá được. Dùng gỡ nội dung thay vì xoá.',
      );
    }
    await this.courses.delete(id);
  }

  /**
   * Quyết định của admin. Kiểm vai trò lại ở đây dù controller đã có `@Roles('admin')`:
   * guard bảo vệ đường HTTP, use case là thứ mọi lối gọi khác cũng đi qua.
   */
  async moderate(
    user: AuthenticatedUser,
    id: string,
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore',
    reason: string | null,
  ) {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const entity = await this.mustFind(id);
    const moderated = entity.moderate(decision, reason);
    if (moderated.isFail) throw moderated.error;

    await this.courses.save(entity);

    // Phát SAU khi ghi thành công, và chỉ khi khoá học thực sự vừa mở cho người học.
    // `request_changes`/`reject`/`archive` không sinh thông báo: người học không cần
    // biết về bản nháp bị trả lại, và `archive` là gỡ xuống chứ không phải ra mắt.
    if (decision === 'approve') {
      await this.announcePublished(entity);
    }
    await this.announceModerated(entity, decision, reason, user.displayName);
    return toView(entity, await this.courses.findCurriculum(id));
  }

  /**
   * Thông báo "có khoá học mới" là việc phụ: nó KHÔNG được làm hỏng thao tác duyệt.
   *
   * Kafka chết mà ném lỗi lên đây thì admin thấy duyệt thất bại trong khi khoá học đã
   * published trong DB — trạng thái sai lệch giữa hai lần bấm. Nuốt lỗi và ghi log là
   * đánh đổi đúng ở đây; muốn đảm bảo không mất message thì đổi sang `OUTBOX_EVENT_BUS`,
   * vốn ghi cùng transaction với dữ liệu nghiệp vụ.
   */
  private async announcePublished(course: Course): Promise<void> {
    try {
      await this.eventBus.publish(TOPICS.COURSE_PUBLISHED, {
        courseId: course.id,
        slug: course.slug,
        title: course.title,
        lecturerName: course.createdBy ? await this.courses.authorNameOf(course.createdBy) : null,
      });
    } catch (error) {
      this.logger.error(`không phát được ${TOPICS.COURSE_PUBLISHED} cho ${course.id}`, error as Error);
    }
  }

  /**
   * Báo riêng cho TÁC GIẢ về quyết định vừa rồi.
   *
   * Tách khỏi `announcePublished`: cái kia nói với người học "có khoá mới", cái này nói
   * với giảng viên "bài của bạn đã được quyết". Cùng một cú bấm duyệt sinh cả hai, và
   * gộp chúng lại nghĩa là một trong hai nhóm nhận nhầm.
   *
   * `restore` không báo: nó chỉ đưa nội dung đã lưu trữ về bản nháp, chưa phải phán quyết.
   */
  private async announceModerated(
    course: Course,
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore',
    reason: string | null,
    moderatorName: string,
  ): Promise<void> {
    if (decision === 'restore') return;
    const author = await this.authors.find(course.createdBy);
    if (!author?.externalId) return;

    try {
      await this.eventBus.publish(TOPICS.CONTENT_MODERATED, {
        kind: 'COURSE',
        contentId: course.id,
        slug: course.slug,
        title: course.title,
        decision,
        reason,
        authorExternalId: author.externalId,
        moderatorName,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_MODERATED} cho ${course.id}`,
        error as Error,
      );
    }
  }

  private async mustFind(id: string): Promise<Course> {
    const course = await this.courses.findById(id);
    if (course === null) throw new NotFound('Khóa học', id);
    return course;
  }

  private async mustOwn(user: AuthenticatedUser, id: string): Promise<Course> {
    const course = await this.mustFind(id);
    if (!canEditCourse(user, { created_by: course.createdBy })) {
      throw new NotAuthorized('thao tác trên khóa học này');
    }
    return course;
  }

  private async freeSlug(explicit: string | undefined, title: string): Promise<string> {
    if (explicit) {
      if (await this.courses.existsBySlug(explicit)) {
        throw new AlreadyExists('Slug', { slug: explicit });
      }
      return explicit;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = slugify(title, attempt === 0 ? undefined : Math.random().toString(36).slice(2, 7));
      if (!(await this.courses.existsBySlug(candidate))) return candidate;
    }
    return slugify(title, randomUUID().slice(0, 8));
  }
}
