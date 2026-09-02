import { Inject, Injectable, Logger } from '@nestjs/common';
import type { InvalidInput, Result } from '@codementor/kernel';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import type { EventEnvelope } from '@codementor/contracts';
import type { NotificationContent } from '../domain/model/notification-content';
import { ReminderPlanner } from './reminder-planner';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/port/notification.repository';

/**
 * Nhận một sự kiện nghiệp vụ đã dịch thành nội dung, lưu lại, rồi báo cho realtime.
 *
 * Thứ tự LƯU TRƯỚC, ĐẨY SAU là có chủ đích: MongoDB mới là nguồn sự thật. WebSocket chỉ
 * là cách giao hàng — người dùng đang offline, tab đã đóng, hay realtime-service đang
 * chết đều không được làm mất thông báo. Đẩy trước rồi mới lưu thì một lần ghi hỏng sẽ
 * tạo ra thông báo mà người dùng thấy chớp qua rồi biến mất sau khi F5.
 */
@Injectable()
export class RecordNotificationUseCase {
  private readonly logger = new Logger(RecordNotificationUseCase.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepository,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
    private readonly emailReminders: ReminderPlanner,
  ) {}

  async record(
    envelope: EventEnvelope<unknown>,
    /**
     * `null` = sự kiện này không đáng báo cho ai (vd. admin lưu trữ một nội dung đã đăng).
     * Khác hẳn `Result` thất bại, vốn là lỗi lập trình trong hàm dựng.
     */
    draft: Result<NotificationContent, InvalidInput> | null,
  ): Promise<void> {
    if (draft === null) return;
    // Nội dung không hợp lệ là lỗi lập trình trong hàm dựng, không phải lỗi của message.
    // Ném ra để `EventConsumer` nhả dấu đã-xử-lý và message được giao lại sau khi sửa —
    // im lặng bỏ qua thì thông báo biến mất vĩnh viễn mà không ai biết.
    if (draft.isFail) throw draft.error;

    const content = draft.value;
    // Email categories are independent of the in-app Workspace switch. Also on replay.
    await this.emailReminders.fromNotification(envelope, content);
    if (!(await this.emailReminders.allowsInApp(content))) return;
    const saved = await this.repository.create(envelope.eventId, content);

    // `null` = đã có thông báo cho đúng eventId này. Kafka giao lại message là chuyện
    // bình thường, không phải lỗi — im lặng bỏ qua và KHÔNG phát lại sự kiện realtime,
    // nếu không client sẽ nghe chuông hai lần cho cùng một việc.
    if (saved === null) {
      this.logger.debug(`bỏ qua ${envelope.eventName} (${envelope.eventId}) — đã có thông báo`);
      return;
    }

    await this.eventBus.publish(
      TOPICS.NOTIFICATION_CREATED,
      {
        notificationId: saved.id,
        type: content.type,
        title: content.title,
        message: content.message,
        audienceType: content.audienceType,
        audienceKey: content.audienceKey,
        referenceType: content.referenceType,
        referenceId: content.referenceId,
        actionLabel: content.actionLabel,
        actionUrl: content.actionUrl,
        createdAt: saved.createdAt.toISOString(),
      },
      // Giữ nguyên correlationId của sự kiện gốc: từ "giảng viên bấm xuất bản" tới
      // "chuông kêu trên máy người học" là một chuỗi, và khi cần truy vết thì phải lần
      // được cả chuỗi bằng một mã duy nhất.
      { correlationId: envelope.correlationId, causationId: envelope.eventId },
    );
  }
}
