import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { AlreadyExists, BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { DEFAULT_PAGE_LIMIT, canEditCourse, decodeCursor, requireHumanId, toPage, ContentAuthorLookup, ObjectStorageService, VIDEO_CONTENT_TYPES, type AuthenticatedUser, type Page, type PresignedUpload } from '@codementor/platform';
import { Course } from '../domain/model/course';
import type { CourseEdit } from '../domain/model/course';
import { deriveEarlyAccessFlags, validateCurriculum, type ChapterDraft } from '../domain/model/curriculum';
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
  authorId?: string;
  updatedFrom?: string;
  updatedTo?: string;
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
  removalRequested: boolean;
  /** Ghi chú tác giả gửi kèm lần duyệt đang chờ. Xem `Course.submitNote`. */
  submitNote: string | null;
  /** `true` khi lần gửi duyệt tới sẽ là gửi LẠI, tức là bắt buộc có ghi chú. */
  requiresSubmitNote: boolean;
  publishedAt: string | null;
  totalChapters: number;
  totalLessons: number;
  updatedAt: string;
  chapters?: CourseChapterView[];
}

/** Bài như studio thấy: cờ "cho học trước" thay cho cạnh phụ thuộc thô. */
export type CourseLessonView = Omit<StoredChapter['lessons'][number], 'prerequisites'> & {
  earlyAccess: boolean;
};
export type CourseChapterView = Omit<StoredChapter, 'lessons'> & { lessons: CourseLessonView[] };

/**
 * `StoredChapter[]` (cạnh phụ thuộc thô, đúng hình dạng CSDL) → `CourseChapterView[]`
 * (cờ "cho học trước", đúng hình dạng studio muốn hiển thị). Xem `deriveEarlyAccessFlags`.
 */
function withEarlyAccess(chapters: StoredChapter[], progressionMode: string): CourseChapterView[] {
  const flags = deriveEarlyAccessFlags(chapters, progressionMode);
  return chapters.map((chapter) => ({
    ...chapter,
    lessons: chapter.lessons.map(({ prerequisites: _prerequisites, ...lesson }) => ({
      ...lesson,
      earlyAccess: flags.get(lesson.id) ?? false,
    })),
  }));
}

function toView(course: Course, chapters?: CourseChapterView[]): CourseView {
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
    removalRequested: course.removalRequested,
    submitNote: course.submitNote,
    requiresSubmitNote: course.requiresSubmitNote,
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
    private readonly storage: ObjectStorageService,
  ) {}

  async list(
    scope:
      | { createdBy: string }
      | { publishedOnly: true }
      | { pendingOnly: true }
      | { adminAll: true },
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
      // Trang quản trị: mọi tác giả, mọi trạng thái trừ nháp — giảng viên chưa gửi duyệt
      // thì đó vẫn là bản riêng của họ, admin không cần thấy cho tới khi có gì để quyết.
      excludeDraft: 'adminAll' in scope,
      level: query.level,
      status,
      authorId: query.authorId,
      updatedFrom: query.updatedFrom ? new Date(query.updatedFrom) : undefined,
      updatedTo: query.updatedTo ? new Date(query.updatedTo) : undefined,
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
    return toView(course, withEarlyAccess(await this.courses.findCurriculum(id), course.progressionMode));
  }

  async getReferences(user: AuthenticatedUser, id: string): Promise<{ roadmaps: { id: string; title: string; slug: string }[] }> {
    const course = await this.mustFind(id);
    if (course.status !== 'published' && !canEditCourse(user, { created_by: course.createdBy })) {
      throw new NotFound('Khóa học', id);
    }

    const roadmaps = await this.courses.findReferencingRoadmaps(id);
    return { roadmaps };
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
    return toView(course, withEarlyAccess(await this.courses.findCurriculum(id), course.progressionMode));
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

    /**
     * `saveCurriculum` (repository) vừa suy VÀ ghi lại cạnh phụ thuộc cho mọi bài — xem
     * `deriveLessonSources`. Cạnh đó chỉ có tác dụng ở chế độ `graph`
     * (`fn_lesson_available` bỏ qua chúng hoàn toàn ở `linear`/gác bằng thứ tự thay), nên
     * khoá luôn phải ở `graph` để "cho học trước" thật sự chạy. Trừ `free`: mở hết là một
     * lựa chọn có chủ ý, ghi đè nó sẽ khoá bài của học viên đang học.
     */
    if (course.progressionMode !== 'free' && course.progressionMode !== 'graph') {
      const switched = course.edit({ progressionMode: 'graph' });
      if (switched.isFail) throw switched.error;
    }

    await this.courses.save(course);

    // Đọc lại thay vì trả bản trong bộ nhớ: `total_chapters` và `total_lessons` do
    // trigger giữ, nên aggregate nạp TRƯỚC lệnh ghi vẫn mang số cũ. Trả nó về là nói
    // với studio rằng khóa học không có chương nào, ngay sau khi vừa lưu hai chương.
    const refreshed = await this.mustFind(id);
    return toView(refreshed, withEarlyAccess(saved, course.progressionMode));
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

  /**
   * Studio hỏi trước khi vẽ: kho lưu trữ đã sẵn sàng chưa, và trần dung lượng là bao nhiêu.
   *
   * Có endpoint riêng cho việc này thay vì để frontend đọc biến môi trường: khoá S3 là bí
   * mật phía máy chủ, và "đã cấu hình hay chưa" là thứ chỉ máy chủ biết chắc. Chưa cấu
   * hình thì studio tắt riêng ô tải lên và vẫn cho dán URL — không phải một màn hình lỗi.
   */
  videoUploadConfig(): { enabled: boolean; maxBytes: number; acceptedTypes: string[] } {
    return {
      enabled: this.storage.isConfigured,
      maxBytes: this.storage.maxUploadBytes,
      acceptedTypes: [...VIDEO_CONTENT_TYPES],
    };
  }

  /**
   * Ký một lệnh ghi cho đúng một video của đúng một bài.
   *
   * Kiểm quyền sở hữu Ở ĐÂY chứ không chỉ ở guard: URL ký sẵn là quyền ghi thật vào
   * bucket, nên đường sinh ra nó phải chặt bằng đường sửa nội dung. Bài cũng phải thuộc
   * đúng khóa học trong URL — thiếu bước đó thì ai sở hữu một khóa học bất kỳ là ký được
   * URL mang tiền tố của khóa học khác, chỉ cần đoán đúng id.
   */
  async presignLessonVideo(
    user: AuthenticatedUser,
    courseId: string,
    lessonId: string,
    input: { filename: string; contentType: string; sizeBytes: number },
  ): Promise<PresignedUpload> {
    const course = await this.mustOwn(user, courseId);
    if (course.isLockedForReview) {
      throw new BusinessRuleViolation('Khóa học đang chờ duyệt. Hủy gửi duyệt trước khi sửa.');
    }

    const curriculum = await this.courses.findCurriculum(courseId);
    const lesson = curriculum
      .flatMap((chapter) => chapter.lessons)
      .find((candidate) => candidate.id === lessonId);
    if (!lesson) throw new NotFound('Bài học', lessonId);

    const signed = await this.storage.presignUpload({
      prefix: `courses/${courseId}/lessons/${lessonId}`,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    if (signed.isFail) throw signed.error;
    return signed.value;
  }

  async submit(user: AuthenticatedUser, id: string, note?: string | null): Promise<CourseView> {
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

    const submitted = course.submit(
      {
        chapters: curriculum.map((chapter) => ({ lessonCount: chapter.lessons.length })),
        lessonsMissingContent,
        exercisesNotUsable,
      },
      note,
    );
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
        note: course.submitNote,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_REVIEW_REQUESTED} cho ${course.id}`,
        error as Error,
      );
    }
    return toView(course, withEarlyAccess(curriculum, course.progressionMode));
  }

  async withdraw(user: AuthenticatedUser, id: string): Promise<CourseView> {
    const course = await this.mustOwn(user, id);
    const withdrawn = course.withdraw();
    if (withdrawn.isFail) throw withdrawn.error;

    await this.courses.save(course);
    return toView(course, withEarlyAccess(await this.courses.findCurriculum(id), course.progressionMode));
  }

  /**
   * Tác giả XIN gỡ khóa học đang công khai của mình — không tự gỡ được nữa, chỉ ghi lại
   * nguyện vọng kèm lý do bắt buộc. Khóa học vẫn `published` cho tới khi admin quyết
   * (`moderate('archive', ...)` để duyệt, `denyRemoval` để từ chối).
   */
  async requestRemoval(user: AuthenticatedUser, id: string, reason: string): Promise<CourseView> {
    const course = await this.mustOwn(user, id);
    const requested = course.requestRemoval(reason);
    if (requested.isFail) throw requested.error;

    await this.courses.save(course);
    // Người nhận là ADMIN. Không có bước này thì yêu cầu xin gỡ nằm im trong CSDL: khoá
    // học vẫn `published` nên nó không rơi vào hàng chờ duyệt, và không ai được báo — tác
    // giả tưởng đã xin, admin không biết có gì để xử lý. Lỗi Kafka chỉ ghi log, cùng lý do
    // đã ghi ở `submit`: nguyện vọng đã lưu rồi, báo lỗi lên đây là nói dối người gửi.
    try {
      await this.eventBus.publish(TOPICS.CONTENT_REMOVAL_REQUESTED, {
        kind: 'COURSE',
        contentId: course.id,
        slug: course.slug,
        title: course.title,
        reason: reason.trim(),
        authorName: user.displayName,
      });
    } catch (error) {
      this.logger.error(
        `không phát được ${TOPICS.CONTENT_REMOVAL_REQUESTED} cho ${course.id}`,
        error as Error,
      );
    }
    return toView(course, withEarlyAccess(await this.courses.findCurriculum(id), course.progressionMode));
  }

  /**
   * Admin từ chối yêu cầu xin gỡ — khóa học không đổi gì, chỉ báo lại cho tác giả rằng
   * nội dung của họ vẫn đang công khai.
   */
  async denyRemoval(user: AuthenticatedUser, id: string): Promise<CourseView> {
    if (user.role !== 'admin') throw new NotAuthorized('xử lý yêu cầu xin gỡ');
    const course = await this.mustFind(id);
    const denied = course.denyRemoval();
    if (denied.isFail) throw denied.error;

    await this.courses.save(course);
    await this.announceModerated(course, 'deny_removal', null, { displayName: user.displayName, externalId: user.externalId });
    return toView(course, withEarlyAccess(await this.courses.findCurriculum(id), course.progressionMode));
  }

  /** Tác giả tự khôi phục khóa học đã gỡ của mình — về draft, đi lại vòng duyệt. */
  async restoreMine(user: AuthenticatedUser, id: string): Promise<CourseView> {
    const course = await this.mustOwn(user, id);
    const restored = course.moderate('restore', null);
    if (restored.isFail) throw restored.error;

    await this.courses.save(course);
    return toView(course, withEarlyAccess(await this.courses.findCurriculum(id), course.progressionMode));
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
    decision: 'approve' | 'request_changes' | 'reject' | 'archive' | 'restore' | 'revert',
    reason: string | null,
  ) {
    if (user.role !== 'admin') throw new NotAuthorized('kiểm duyệt nội dung');

    const entity = await this.mustFind(id);
    const moderated = entity.moderate(decision, reason);
    if (moderated.isFail) throw moderated.error;

    await this.courses.save(entity);

    // Phát SAU khi ghi thành công, và chỉ khi khoá học thực sự vừa mở cho người học.
    // `announcePublished` là báo cho NGƯỜI HỌC "có khoá mới"; `announceModerated` ngay
    // dưới đây báo riêng cho TÁC GIẢ, ở mọi quyết định trừ `restore`.
    if (decision === 'approve') {
      await this.announcePublished(entity);
    }
    await this.announceModerated(entity, decision, reason, { displayName: user.displayName, externalId: user.externalId });
    return toView(entity, withEarlyAccess(await this.courses.findCurriculum(id), entity.progressionMode));
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
   * `restore` và `revert` VẪN phát sự kiện dù không sinh thông báo nào — chúng chưa phải
   * phán quyết để báo cho tác giả, nhưng đây là nguồn dữ liệu duy nhất của nhật ký kiểm
   * toán, và "ai đã rút lại quyết định này, lúc nào" là đúng thứ nhật ký đó tồn tại để
   * trả lời. Việc lọc ra nằm ở `fromContentModerated` bên notification-service.
   */
  private async announceModerated(
    course: Course,
    decision:
      | 'approve'
      | 'request_changes'
      | 'reject'
      | 'archive'
      | 'restore'
      | 'revert'
      | 'deny_removal',
    reason: string | null,
    moderator: { displayName: string; externalId: string },
  ): Promise<void> {
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
        moderatorName: moderator.displayName,
        moderatorExternalId: moderator.externalId,
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
