import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
  type NotificationView,
} from '../domain/port/notification.repository';

/** Trần cứng để một client hỏi `limit=100000` không kéo sập service. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export interface NotificationPage {
  items: NotificationView[];
  /** `createdAt` của mục cuối, truyền lại làm `before` để lấy trang kế. `null` = hết. */
  nextCursor: string | null;
}

@Injectable()
export class NotificationQuery {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repository: NotificationRepository,
  ) {}

  async list(userId: string, limit?: number, before?: string): Promise<NotificationPage> {
    const size = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = before ? new Date(before) : undefined;
    // `new Date('rác')` cho Invalid Date, và Mongo sẽ ném lỗi khó hiểu ở tận tầng driver.
    const items = await this.repository.list(
      userId,
      size,
      cursor && !Number.isNaN(cursor.getTime()) ? cursor : undefined,
    );

    return {
      items,
      // Trang đầy nghĩa là CÓ THỂ còn nữa. Trả con trỏ kể cả khi trang sau rỗng vẫn đúng
      // hơn là đoán: đoán sai theo hướng ngược lại sẽ giấu mất thông báo của người dùng.
      nextCursor: items.length === size ? items[items.length - 1].createdAt : null,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.repository.unreadCount(userId);
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const found = await this.repository.markRead(userId, notificationId);
    if (!found) throw new NotFoundException('Không tìm thấy thông báo');
  }

  markAllRead(userId: string): Promise<number> {
    return this.repository.markAllRead(userId);
  }
}
