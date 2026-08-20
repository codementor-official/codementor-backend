/**
 * Ghi danh và tiến độ học.
 *
 * Chỉ có MỘT thứ được ghi ở đây: `lesson_progress`. `course_enrollments.progress_percent`
 * và `roadmap_enrollments.*` là cache do trigger `0012` giữ — migration nói thẳng
 * "The application never writes these columns", và `verify.sql` kiểm lại bất biến đó. Ghi
 * tay vào chúng thì con số đúng cho tới lần đầu ai đó học xong một bài.
 *
 * Điều kiện mở bài cũng không tính ở đây: `fn_lesson_available` trong migration `0011` là
 * nơi duy nhất biết luật `free`/`linear`/`graph`. Viết lại luật đó bằng TypeScript nghĩa là
 * có hai bản, và chúng sẽ lệch nhau.
 */
export type EnrollmentStatus = 'active' | 'completed' | 'paused' | 'dropped';
export type ProgressStatus = 'not_started' | 'in_progress' | 'completed';

export interface CourseEnrollment {
  id: string;
  userId: string;
  courseId: string;
  viaRoadmapId: string | null;
  status: EnrollmentStatus;
  /** Cache — trigger giữ. Đọc để hiển thị, không bao giờ ghi. */
  completedLessons: number;
  progressPercent: number;
  startedAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date | null;
}

export interface LessonProgress {
  lessonId: string;
  status: ProgressStatus;
  timeSpentSeconds: number;
  lastPositionSeconds: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** Bài học kèm trạng thái của riêng người đang hỏi, và bài đó đã mở chưa. */
export interface LessonProgressView extends LessonProgress {
  isAvailable: boolean;
}

export interface RecordProgressInput {
  status: ProgressStatus;
  timeSpentSeconds?: number;
  lastPositionSeconds?: number | null;
}

/** Một khoá đã ghi danh, đủ để vẽ thẻ trong "Khoá học của tôi" mà không phải gọi thêm. */
export interface EnrolledCourseView extends CourseEnrollment {
  title: string;
  slug: string;
  level: string;
  coverImageUrl: string | null;
  durationHours: number | null;
  totalChapters: number;
  totalLessons: number;
}

export interface EnrollmentRepository {
  findCourseEnrollment(userId: string, courseId: string): Promise<CourseEnrollment | null>;

  /** Mọi khoá đã ghi danh của một người, mới hoạt động trước — "Khoá học của tôi". */
  listMine(userId: string): Promise<EnrolledCourseView[]>;

  /**
   * Ghi danh, hoặc kích hoạt lại nếu người học từng bỏ.
   *
   * Không xoá rồi tạo mới: `UNIQUE (user_id, course_id)` là có chủ đích, và một hàng mới
   * sẽ đặt lại `started_at` — người quay lại sau ba tháng sẽ mất mốc "bắt đầu từ bao giờ",
   * còn `lesson_progress` thì vẫn còn nguyên nên phần trăm lại không khớp ngày bắt đầu.
   */
  enroll(userId: string, courseId: string, viaRoadmapId: string | null): Promise<CourseEnrollment>;

  /** Bỏ học. Tiến độ giữ nguyên — quay lại là học tiếp, không phải học lại. */
  drop(userId: string, courseId: string): Promise<void>;

  /** Tiến độ mọi bài của một khóa, kèm cờ mở/khóa từ `fn_lesson_available`. */
  findCourseProgress(userId: string, courseId: string): Promise<LessonProgressView[]>;

  /**
   * Ghi tiến độ một bài. Trigger tự cập nhật cache khóa học và mọi lộ trình chứa nó.
   *
   * Trả về `null` khi bài không thuộc khóa học người dùng đã ghi danh — người gọi biến nó
   * thành 403/404 thay vì im lặng tạo một hàng tiến độ mồ côi.
   */
  recordLessonProgress(
    userId: string,
    lessonId: string,
    input: RecordProgressInput,
  ): Promise<LessonProgress | null>;

  /** Khóa học chứa bài này, để kiểm tra quyền và ghi danh trước khi ghi. */
  findCourseIdForLesson(lessonId: string): Promise<string | null>;

  /**
   * `sub` của Keycloak → `users.id`.
   *
   * Đường HTTP không cần: guard đã phân giải sẵn vào `AuthenticatedUser.id`. Consumer Kafka
   * thì cần, vì message chỉ mang được id của nhà cung cấp danh tính — judge không biết khoá
   * chính trong CSDL của ta, và không nên biết.
   */
  findUserIdByExternalId(externalId: string): Promise<string | null>;
}

export const ENROLLMENT_REPOSITORY = Symbol('ENROLLMENT_REPOSITORY');
