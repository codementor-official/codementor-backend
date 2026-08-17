import { Inject, Injectable } from '@nestjs/common';
import { BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { requireHumanId, type AuthenticatedUser } from '@codementor/platform';
import { COURSE_REPOSITORY, type CourseRepository } from '../domain/port/course.repository';
import {
  ENROLLMENT_REPOSITORY,
  type CourseEnrollment,
  type EnrollmentRepository,
  type LessonProgressView,
  type RecordProgressInput,
} from '../domain/port/enrollment.repository';

export interface CourseProgressView {
  enrollment: CourseEnrollment | null;
  lessons: LessonProgressView[];
}

@Injectable()
export class EnrollmentUseCases {
  constructor(
    @Inject(ENROLLMENT_REPOSITORY) private readonly enrollments: EnrollmentRepository,
    @Inject(COURSE_REPOSITORY) private readonly courses: CourseRepository,
  ) {}

  /**
   * Ghi danh vào một khóa học đã công khai.
   *
   * Chặn khóa chưa `published` ở đây chứ không ở CSDL: FK chỉ biết khóa học tồn tại. Cho
   * ghi danh vào bản nháp nghĩa là người học tích lũy tiến độ trên nội dung có thể bị đổi
   * hoặc gỡ, và phần trăm của họ sẽ nhảy khi tác giả sửa cây bài.
   */
  async enroll(
    user: AuthenticatedUser,
    courseId: string,
    viaRoadmapId: string | null = null,
  ): Promise<CourseEnrollment> {
    const userId = requireHumanId(user);
    const course = await this.courses.findById(courseId);
    if (!course) throw new NotFound('Không tìm thấy khóa học');
    if (course.status !== 'published') {
      throw new BusinessRuleViolation('Khóa học chưa được công khai');
    }
    return this.enrollments.enroll(userId, courseId, viaRoadmapId);
  }

  async drop(user: AuthenticatedUser, courseId: string): Promise<void> {
    await this.enrollments.drop(requireHumanId(user), courseId);
  }

  /**
   * Tiến độ của tôi trong một khóa học.
   *
   * `enrollment: null` khi chưa ghi danh — vẫn trả về danh sách bài kèm cờ mở/khóa, để
   * trang chi tiết vẽ được mục lục trước khi người ta bấm "Đăng ký".
   */
  async courseProgress(user: AuthenticatedUser, courseId: string): Promise<CourseProgressView> {
    const userId = requireHumanId(user);
    const [enrollment, lessons] = await Promise.all([
      this.enrollments.findCourseEnrollment(userId, courseId),
      this.enrollments.findCourseProgress(userId, courseId),
    ]);
    return { enrollment, lessons };
  }

  /**
   * Ghi tiến độ một bài.
   *
   * Ba điều kiện, theo thứ tự tăng dần chi phí: bài có tồn tại không, người này đã ghi danh
   * chưa, và bài đã mở chưa. Cái cuối đọc `fn_lesson_available` — cùng một hàm mà giao diện
   * dùng để làm mờ bài bị khóa, nên không có cách nào hai bên trả lời khác nhau.
   */
  async recordLessonProgress(
    user: AuthenticatedUser,
    lessonId: string,
    input: RecordProgressInput,
  ): Promise<LessonProgressView> {
    return this.recordForUser(requireHumanId(user), lessonId, input);
  }

  /**
   * Cùng luật, nhưng nhận thẳng `userId`.
   *
   * Tồn tại vì tiến độ giờ còn được ghi từ một consumer Kafka, nơi không có request nào và
   * do đó không có `AuthenticatedUser`. Luật kiểm tra phải là MỘT bộ duy nhất: nếu consumer
   * đi đường riêng thì sớm muộn sẽ ghi được tiến độ cho một bài đang khóa, thứ mà đường HTTP
   * từ chối — và không ai phát hiện ra cho tới khi thứ tự bài học loạn.
   */
  async recordForUser(
    userId: string,
    lessonId: string,
    input: RecordProgressInput,
  ): Promise<LessonProgressView> {
    const courseId = await this.enrollments.findCourseIdForLesson(lessonId);
    if (!courseId) throw new NotFound('Không tìm thấy bài học');

    const enrollment = await this.enrollments.findCourseEnrollment(userId, courseId);
    if (!enrollment || enrollment.status === 'dropped') {
      throw new NotAuthorized('Cần đăng ký khóa học trước khi lưu tiến độ');
    }

    const before = await this.enrollments.findCourseProgress(userId, courseId);
    const target = before.find((lesson) => lesson.lessonId === lessonId);
    if (target && !target.isAvailable) {
      throw new BusinessRuleViolation('Bài học chưa mở — hoàn thành các bài trước đó');
    }

    const saved = await this.enrollments.recordLessonProgress(userId, lessonId, input);
    if (!saved) throw new NotFound('Không tìm thấy bài học');

    // Đọc lại cờ khả dụng: hoàn thành bài này có thể vừa mở bài kế tiếp, và người gọi cần
    // biết điều đó ngay thay vì phải gọi thêm một vòng.
    const after = await this.enrollments.findCourseProgress(userId, courseId);
    const view = after.find((lesson) => lesson.lessonId === lessonId);
    return view ?? { ...saved, isAvailable: true };
  }
}
