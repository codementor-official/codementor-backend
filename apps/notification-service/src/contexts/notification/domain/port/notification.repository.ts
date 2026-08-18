import type { NotificationContent } from '../model/notification-content';

/**
 * Một thông báo kèm trạng thái đọc của đúng người đang hỏi.
 *
 * Đây là hình chiếu để đọc, không phải aggregate: đường đọc không sửa gì, và dựng lại
 * entity chỉ để lấy ra vài trường rồi vứt đi là công vô ích. Cùng cách mà
 * `CourseListItem` và `exercise-view.ts` đang làm ở các service khác.
 */
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  message: string;
  referenceType: string | null;
  referenceId: string | null;
  actionLabel: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

/** Thông báo vừa được ghi, đủ để phát tiếp `evt.notification.created.v1`. */
export interface StoredNotification {
  id: string;
  content: NotificationContent;
  createdAt: Date;
}

/**
 * Người đang đọc. Cả `externalId` lẫn `role` đều cần: một thông báo tới được người này
 * nếu nó gửi cho tất cả, cho vai trò của họ, hoặc đích danh họ.
 */
export interface Viewer {
  userId: string;
  externalId: string;
  role: string;
}

export interface NotificationRepository {
  /**
   * Ghi thông báo mới. Trả `null` nếu `eventId` đã có — Kafka giao lại message là
   * chuyện bình thường, không phải lỗi.
   */
  create(eventId: string, content: NotificationContent): Promise<StoredNotification | null>;

  /** Mới nhất trước. `before` là con trỏ `createdAt` của trang liền trước. */
  list(viewer: Viewer, limit: number, before?: Date): Promise<NotificationView[]>;

  unreadCount(viewer: Viewer): Promise<number>;

  /** `false` nếu không có thông báo nào mang id đó. */
  markRead(userId: string, notificationId: string): Promise<boolean>;

  /** Trả về số thông báo vừa được đánh dấu. */
  markAllRead(viewer: Viewer): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
