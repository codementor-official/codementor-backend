import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BusinessRuleViolation, NotAuthorized, NotFound } from '@codementor/kernel';
import { EventConsumer } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import {
  ENROLLMENT_REPOSITORY,
  type EnrollmentRepository,
} from '../domain/port/enrollment.repository';
import { Inject } from '@nestjs/common';
import { EnrollmentUseCases } from './enrollment.usecases';

/**
 * Chấm đạt một bài code mở từ trong khóa học → đánh dấu bài học đó hoàn thành.
 *
 * Trước đây người học tự bấm "đã hoàn thành" cho bài code, vì judge chấm xong là dừng và
 * không có gì báo cho learning-service. Đây là mẩu còn thiếu đó.
 *
 * Quyết định vẫn thuộc về service này, không phải judge: judge chỉ kể "người này giải đạt
 * bài kia trong ngữ cảnh khóa học nọ". Ai chưa ghi danh, hay bài chưa mở theo thứ tự, thì
 * message bị bỏ qua — cùng bộ luật mà đường HTTP dùng, qua `recordForUser`.
 */
@Injectable()
export class ExerciseSolvedConsumer implements OnModuleInit {
  private readonly logger = new Logger(ExerciseSolvedConsumer.name);

  constructor(
    private readonly events: EventConsumer,
    private readonly enrollmentUseCases: EnrollmentUseCases,
    @Inject(ENROLLMENT_REPOSITORY) private readonly enrollments: EnrollmentRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.events.on(TOPICS.EXERCISE_SOLVED, async (payload) => {
      const { externalUserId, courseId, lessonId, exerciseId } = payload;

      // `sub` của Keycloak → khoá chính của ta. Không có hàng nào nghĩa là người này chưa
      // từng gọi API nào của CodeMentor, nên cũng chưa ghi danh khóa nào.
      const userId = await this.enrollments.findUserIdByExternalId(externalUserId);
      if (!userId) {
        this.logger.warn(`bỏ qua evt.exercise.solved: không có users.id cho ${externalUserId}`);
        return;
      }

      // Judge nói bài học này thuộc khóa nào, nhưng nó lấy từ payload của client. Đối chiếu
      // lại với CSDL: nếu không khớp thì có người đang cố ghi tiến độ cho khóa khác.
      const actualCourseId = await this.enrollments.findCourseIdForLesson(lessonId);
      if (actualCourseId !== courseId) {
        this.logger.warn(
          `bỏ qua evt.exercise.solved: bài ${lessonId} thuộc khóa ${actualCourseId}, không phải ${courseId}`,
        );
        return;
      }

      try {
        await this.enrollmentUseCases.recordForUser(userId, lessonId, { status: 'completed' });
        this.logger.log(`bài ${lessonId} của ${userId} hoàn thành nhờ giải đạt ${exerciseId}`);
      } catch (cause) {
        // Chưa ghi danh, hoặc bài chưa mở theo thứ tự học. Cả hai đều là câu trả lời hợp lệ
        // của luật, không phải sự cố — ném lại sẽ khiến Kafka giao lại message mãi mãi.
        if (
          cause instanceof NotAuthorized ||
          cause instanceof BusinessRuleViolation ||
          cause instanceof NotFound
        ) {
          this.logger.warn(`không ghi tiến độ ${lessonId} cho ${userId}: ${cause.message}`);
          return;
        }
        throw cause;
      }
    });

    try {
      await this.events.start('learning-service');
    } catch (cause) {
      // Kafka chưa lên không được phép làm chết service: toàn bộ API khóa học vẫn phải
      // phục vụ được. Hệ quả duy nhất là bài code giải đạt sẽ không tự đánh dấu hoàn thành
      // cho tới khi Kafka trở lại — và message vẫn nằm đó chờ vì consumer group giữ offset.
      this.logger.error(`không đăng ký được consumer Kafka: ${String(cause)}`);
    }
  }
}
