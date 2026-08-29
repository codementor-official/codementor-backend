import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventConsumer } from '@codementor/messaging';
import {
  TOPICS,
  type ContentModeratedV1,
  type ReviewableKind,
  type SubmissionEvaluatedV1,
} from '@codementor/contracts';
import { PrismaService } from '@codementor/platform';
import { AuditLogService } from './audit-log.service';

/**
 * `target_type` trong `audit_logs`. Số ít, chữ thường — cùng quy ước với `user`, giá trị
 * duy nhất bảng này có trước đây. Không dùng thẳng `ReviewableKind` (`COURSE`, `POST`…):
 * đó là từ vựng của Kafka, và nhật ký kiểm toán được lọc bằng chuỗi trong URL.
 */
const TARGET_TYPE: Record<ReviewableKind, string> = {
  COURSE: 'course',
  ROADMAP: 'roadmap',
  EXERCISE: 'exercise',
  POST: 'article',
};

const KIND_LABEL: Record<ReviewableKind, string> = {
  COURSE: 'khoá học',
  ROADMAP: 'lộ trình',
  EXERCISE: 'bài code',
  POST: 'bài viết',
};

/** Câu quản trị viên đọc trong nhật ký. Quá khứ, vì nhật ký kể việc đã xảy ra. */
const VERB: Record<ContentModeratedV1['decision'], string> = {
  approve: 'đã duyệt',
  request_changes: 'yêu cầu sửa',
  reject: 'đã từ chối',
  archive: 'đã gỡ khỏi danh mục',
  restore: 'đã khôi phục về bản nháp',
  revert: 'đã rút lại quyết định, đưa về hàng chờ duyệt',
  deny_removal: 'đã từ chối yêu cầu xin gỡ',
};

/**
 * Mọi quyết định kiểm duyệt → một dòng `audit_logs`.
 *
 * Ghi qua CONSUMER chứ không để learning-service/exercise-service ghi thẳng vào bảng, và
 * đó là luật chứ không phải sở thích: `audit_logs` thuộc core-service (xem đầu file
 * migration 0020, nơi đúng thiết kế này được viết ra trước khi có ai cần tới nó). Một
 * service ghi vào bảng của service khác là ranh giới dữ liệu bị phá ở chỗ khó thấy nhất.
 *
 * Đây là lý do `restore` và `revert` vẫn phát `CONTENT_MODERATED` dù không sinh thông báo
 * nào: chúng không có gì để nói với tác giả, nhưng "ai đã rút lại quyết định này, lúc
 * nào" là đúng câu hỏi nhật ký kiểm toán tồn tại để trả lời.
 *
 * Trùng lặp do `EventConsumer` lo (bảng `processed_events`), nên một message được giao
 * lại không sinh hai dòng nhật ký.
 */
@Injectable()
export class ModerationAuditConsumer implements OnModuleInit {
  private readonly logger = new Logger(ModerationAuditConsumer.name);

  constructor(
    private readonly consumer: EventConsumer,
    private readonly audit: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer.on(TOPICS.CONTENT_MODERATED, (payload) => this.record(payload));
    this.consumer.on(TOPICS.SUBMISSION_EVALUATED, (payload) => this.recordSolvedExercise(payload));

    try {
      await this.consumer.start('core-service');
    } catch (cause) {
      // Kafka chưa lên không được phép làm chết service: toàn bộ API tài khoản vẫn phải
      // phục vụ được. Hệ quả duy nhất là nhật ký kiểm duyệt chậm lại cho tới khi Kafka
      // trở lại — message vẫn nằm đó chờ vì consumer group giữ offset.
      this.logger.error(`không đăng ký được consumer Kafka: ${String(cause)}`);
    }
  }

  private async recordSolvedExercise(payload: SubmissionEvaluatedV1): Promise<void> {
    // XP can legitimately be zero. `firstAccepted` is the business fact that decides
    // whether solved_count and streak advance; using the reward as a proxy skipped those exercises.
    if (!payload.accepted || !payload.firstAccepted) return;

    await this.prisma.$executeRaw`
      INSERT INTO user_stats
        (user_id, xp, solved_count, current_streak_days, longest_streak_days, last_solved_on)
      VALUES (${payload.userId}::uuid, ${payload.xpAwarded}, 1, 1, 1, CURRENT_DATE)
      ON CONFLICT (user_id) DO UPDATE SET
        xp = user_stats.xp + EXCLUDED.xp,
        solved_count = user_stats.solved_count + 1,
        current_streak_days = CASE
          WHEN user_stats.last_solved_on = CURRENT_DATE THEN user_stats.current_streak_days
          WHEN user_stats.last_solved_on = CURRENT_DATE - 1 THEN user_stats.current_streak_days + 1
          ELSE 1
        END,
        longest_streak_days = GREATEST(
          user_stats.longest_streak_days,
          CASE
            WHEN user_stats.last_solved_on = CURRENT_DATE THEN user_stats.current_streak_days
            WHEN user_stats.last_solved_on = CURRENT_DATE - 1 THEN user_stats.current_streak_days + 1
            ELSE 1
          END
        ),
        last_solved_on = CURRENT_DATE,
        updated_at = now()`;
  }

  private async record(payload: ContentModeratedV1): Promise<void> {
    const reason = payload.reason?.trim() || null;
    const who = payload.moderatorName.trim() || 'Quản trị viên';

    await this.audit.record(
      { externalId: payload.moderatorExternalId, email: who },
      {
        action: `content.${payload.decision}`,
        targetType: TARGET_TYPE[payload.kind],
        targetId: payload.contentId,
        summary: `${who} ${VERB[payload.decision]} ${KIND_LABEL[payload.kind]} “${payload.title}”`,
        metadata: {
          kind: payload.kind,
          slug: payload.slug,
          decision: payload.decision,
          reason,
          moderatorName: payload.moderatorName,
        },
      },
    );
    this.logger.debug(`ghi nhật ký ${payload.decision} cho ${payload.kind} ${payload.contentId}`);
  }
}
