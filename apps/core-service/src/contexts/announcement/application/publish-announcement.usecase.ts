import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { NotAuthorized } from '@codementor/kernel';
import { requireHumanId, type AuthenticatedUser } from '@codementor/platform';

/**
 * Admin gửi thông báo cho toàn hệ thống.
 *
 * Không có bảng `announcements`: bản thân thông báo trong MongoDB của notification-service
 * CHÍNH LÀ bản ghi. Thêm một bảng ở đây sẽ tạo ra hai nguồn sự thật cho cùng một câu chữ,
 * và không ai trả lời được cái nào đúng khi hai bên lệch nhau.
 *
 * Vì thế use case này chỉ làm đúng một việc: kiểm quyền rồi phát sự kiện. Khác với
 * course/exercise — ở đó lỗi Kafka được nuốt vì việc chính (duyệt nội dung) đã xong —
 * ở đây phát sự kiện LÀ việc chính, nên lỗi phải nổi lên để admin biết mà gửi lại.
 */
@Injectable()
export class PublishAnnouncementUseCase {
  constructor(@Inject(EVENT_BUS) private readonly eventBus: EventBus) {}

  async execute(
    user: AuthenticatedUser,
    input: { title: string; message: string },
  ): Promise<{ announcementId: string }> {
    // Kiểm lại dù controller đã có `@Roles('admin')`: guard bảo vệ đường HTTP, use case
    // là thứ mọi lối gọi khác cũng đi qua.
    if (user.role !== 'admin') throw new NotAuthorized('gửi thông báo hệ thống');

    const announcementId = randomUUID();
    await this.eventBus.publish(
      TOPICS.ADMIN_ANNOUNCEMENT_CREATED,
      { announcementId, title: input.title, message: input.message },
      { actorUserId: requireHumanId(user) },
    );
    return { announcementId };
  }
}
