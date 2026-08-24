import { Injectable } from '@nestjs/common';
import { PrismaService, mapDatabaseError } from '@codementor/platform';
import type {
  CourseEnrollment,
  EnrolledCourseView,
  EnrollmentRepository,
  LessonProgress,
  LessonProgressView,
  RecordProgressInput,
} from '../domain/port/enrollment.repository';

interface EnrollmentRow {
  id: string;
  userId: string;
  courseId: string;
  viaRoadmapId: string | null;
  status: CourseEnrollment['status'];
  completedLessons: number;
  progressPercent: string | number;
  startedAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date | null;
}

interface EnrolledCourseRow extends EnrollmentRow {
  title: string;
  slug: string;
  level: string;
  coverImageUrl: string | null;
  durationHours: number | null;
  totalChapters: number;
  totalLessons: number;
}

interface ProgressRow {
  lessonId: string;
  status: LessonProgress['status'];
  timeSpentSeconds: number;
  lastPositionSeconds: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  isAvailable: boolean;
}

/** `numeric(5,2)` về JS là string qua driver — ép một chỗ thay vì ở mỗi call site. */
function toEnrollment(row: EnrollmentRow): CourseEnrollment {
  return { ...row, progressPercent: Number(row.progressPercent) };
}

@Injectable()
export class PrismaEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCourseEnrollment(userId: string, courseId: string): Promise<CourseEnrollment | null> {
    const rows = await this.prisma.$queryRaw<EnrollmentRow[]>`
      SELECT id, user_id AS "userId", course_id AS "courseId", via_roadmap_id AS "viaRoadmapId",
             status::text AS status, completed_lessons AS "completedLessons",
             progress_percent AS "progressPercent", started_at AS "startedAt",
             completed_at AS "completedAt", last_activity_at AS "lastActivityAt"
      FROM course_enrollments
      WHERE user_id = ${userId}::uuid AND course_id = ${courseId}::uuid`;
    return rows[0] ? toEnrollment(rows[0]) : null;
  }

  async listMine(userId: string): Promise<EnrolledCourseView[]> {
    // `dropped` không hiện ở đây — "khoá học của tôi" là những khoá đang học hoặc đã
    // xong, không phải nhật ký mọi khoá từng đụng vào. Bỏ học rồi ghi danh lại thì
    // `enroll()` đã đưa `status` về `active`, nên khoá đó tự quay lại danh sách.
    const rows = await this.prisma.$queryRaw<EnrolledCourseRow[]>`
      SELECT ce.id, ce.user_id AS "userId", ce.course_id AS "courseId",
             ce.via_roadmap_id AS "viaRoadmapId", ce.status::text AS status,
             ce.completed_lessons AS "completedLessons",
             ce.progress_percent AS "progressPercent", ce.started_at AS "startedAt",
             ce.completed_at AS "completedAt", ce.last_activity_at AS "lastActivityAt",
             c.title, c.slug::text AS slug, c.level::text AS level,
             c.cover_image_url AS "coverImageUrl", c.duration_hours AS "durationHours",
             c.total_chapters AS "totalChapters", c.total_lessons AS "totalLessons"
      FROM course_enrollments ce
      JOIN courses c ON c.id = ce.course_id
      WHERE ce.user_id = ${userId}::uuid AND ce.status <> 'dropped'
      ORDER BY ce.last_activity_at DESC NULLS LAST, ce.started_at DESC`;
    return rows.map((row) => ({ ...row, progressPercent: Number(row.progressPercent) }));
  }

  async enroll(
    userId: string,
    courseId: string,
    viaRoadmapId: string | null,
  ): Promise<CourseEnrollment> {
    try {
      // Ghi danh lại sau khi bỏ chỉ đổi `status`: `started_at` giữ nguyên mốc thật, và
      // `completed_at` phải về NULL để không vi phạm `completed_consistency`.
      const rows = await this.prisma.$queryRaw<EnrollmentRow[]>`
        INSERT INTO course_enrollments (user_id, course_id, via_roadmap_id, status, last_activity_at)
        VALUES (${userId}::uuid, ${courseId}::uuid, ${viaRoadmapId}::uuid, 'active', now())
        ON CONFLICT (user_id, course_id) DO UPDATE
          SET status = CASE WHEN course_enrollments.status = 'dropped'
                            THEN 'active'::enrollment_status
                            ELSE course_enrollments.status END,
              completed_at = CASE WHEN course_enrollments.status = 'dropped'
                                  THEN NULL ELSE course_enrollments.completed_at END,
              via_roadmap_id = COALESCE(EXCLUDED.via_roadmap_id, course_enrollments.via_roadmap_id),
              last_activity_at = now()
        RETURNING id, user_id AS "userId", course_id AS "courseId",
                  via_roadmap_id AS "viaRoadmapId", status::text AS status,
                  completed_lessons AS "completedLessons", progress_percent AS "progressPercent",
                  started_at AS "startedAt", completed_at AS "completedAt",
                  last_activity_at AS "lastActivityAt"`;
      return toEnrollment(rows[0]);
    } catch (cause) {
      // FK vi phạm = khóa học không tồn tại. Để driver quyết định mã lỗi, đừng đoán.
      throw mapDatabaseError(cause);
    }
  }

  async drop(userId: string, courseId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE course_enrollments
      SET status = 'dropped', last_activity_at = now(), completed_at = NULL
      WHERE user_id = ${userId}::uuid AND course_id = ${courseId}::uuid`;
  }

  async findCourseProgress(userId: string, courseId: string): Promise<LessonProgressView[]> {
    // LEFT JOIN: một bài chưa từng mở không có hàng `lesson_progress`, và nó vẫn phải xuất
    // hiện với trạng thái `not_started` — nếu không, client không phân biệt được "chưa học"
    // với "không tồn tại".
    return this.prisma.$queryRaw<ProgressRow[]>`
      SELECT l.id AS "lessonId",
             COALESCE(p.status::text, 'not_started') AS status,
             COALESCE(p.time_spent_seconds, 0) AS "timeSpentSeconds",
             p.last_position_seconds AS "lastPositionSeconds",
             p.started_at AS "startedAt",
             p.completed_at AS "completedAt",
             fn_lesson_available(${userId}::uuid, l.id) AS "isAvailable"
      FROM lessons l
      JOIN chapters ch ON ch.id = l.chapter_id
      LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ${userId}::uuid
      WHERE l.course_id = ${courseId}::uuid
      -- Sắp theo (chương, bài), không phải l.position một mình: position đánh số lại từ 1
      -- trong mỗi chương, nên sắp theo nó sẽ trộn bài 1 của chương 2 vào trước bài 2 của
      -- chương 1. Đây đúng là thứ tự fn_lesson_available dùng để quyết định bài nào mở.
      ORDER BY ch.position, l.position`;
  }

  async recordLessonProgress(
    userId: string,
    lessonId: string,
    input: RecordProgressInput,
  ): Promise<LessonProgress | null> {
    const completed = input.status === 'completed';
    try {
      const rows = await this.prisma.$queryRaw<LessonProgress[]>`
        INSERT INTO lesson_progress (
          user_id, lesson_id, status, time_spent_seconds, last_position_seconds,
          started_at, completed_at
        )
        VALUES (
          ${userId}::uuid, ${lessonId}::uuid, ${input.status}::progress_status,
          ${input.timeSpentSeconds ?? 0}, ${input.lastPositionSeconds ?? null},
          now(), ${completed ? new Date() : null}
        )
        ON CONFLICT (user_id, lesson_id) DO UPDATE SET
          /*
           * Tiến độ chỉ đi TỚI: đã completed thì ở lại completed.
           *
           * Trước đây dòng này là "status = EXCLUDED.status" không điều kiện, và cột
           * completed_at bị đặt về NULL với mọi lần ghi không phải completed. Hệ quả dây
           * chuyền khi một bài đã xong bị ghi đè bằng in_progress — thứ xảy ra ngay lần
           * đầu có ai đó lưu điểm dừng video của một bài đã học xong:
           *
           *   - fn_lesson_available gác theo status = completed, nên bài KẾ TIẾP khoá
           *     lại, và chính nó cũng không ghi tiến độ được nữa (422).
           *   - fn_refresh_course_progress đếm lại, hạ course_enrollments từ completed
           *     xuống active và xoá completed_at.
           *   - Trigger chạy tiếp fn_refresh_roadmap_progress cho mọi lộ trình chứa khoá
           *     này, nên một lộ trình đã xong cũng mất luôn.
           *
           * Người học không có cách nào lấy lại ngoài học lại từ đầu. Chặn ở đây chứ không
           * ở chỗ gọi: consumer Kafka và đường HTTP đều đi qua đúng câu lệnh này, còn thêm
           * một guard ở mỗi nơi gọi thì nơi gọi thứ ba sẽ quên.
           *
           * Kiểm bằng: npm run verify:progress-monotonic
           */
          status = CASE WHEN lesson_progress.status = 'completed'
                        THEN 'completed'::progress_status
                        ELSE EXCLUDED.status END,
          -- Cộng dồn: mỗi lần client báo là thời gian của phiên đó, không phải tổng.
          time_spent_seconds = lesson_progress.time_spent_seconds + EXCLUDED.time_spent_seconds,
          last_position_seconds = COALESCE(EXCLUDED.last_position_seconds,
                                           lesson_progress.last_position_seconds),
          started_at = COALESCE(lesson_progress.started_at, EXCLUDED.started_at),
          -- Xong rồi thì giữ mốc cũ: học lại một bài đã hoàn thành không dời ngày hoàn
          -- thành. now() ở cuối giữ bất biến "đã xong thì phải có ngày xong" cho những
          -- hàng cũ lỡ mang completed mà completed_at rỗng.
          completed_at = CASE
            WHEN lesson_progress.status = 'completed' OR EXCLUDED.status = 'completed'
              THEN COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at, now())
            ELSE NULL END
        RETURNING lesson_id AS "lessonId", status::text AS status,
                  time_spent_seconds AS "timeSpentSeconds",
                  last_position_seconds AS "lastPositionSeconds",
                  started_at AS "startedAt", completed_at AS "completedAt"`;
      return rows[0] ?? null;
    } catch (cause) {
      throw mapDatabaseError(cause);
    }
  }

  async findUserIdByExternalId(externalId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE external_id = ${externalId}`;
    return rows[0]?.id ?? null;
  }

  async findCourseIdForLesson(lessonId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ courseId: string }[]>`
      SELECT course_id AS "courseId" FROM lessons WHERE id = ${lessonId}::uuid`;
    return rows[0]?.courseId ?? null;
  }
}
