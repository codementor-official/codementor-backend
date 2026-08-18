import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { NotificationContent } from '../domain/model/notification-content';
import type {
  NotificationRepository,
  NotificationView,
  StoredNotification,
  Viewer,
} from '../domain/port/notification.repository';
import { Notification, NotificationRead } from './notification.schema';

/** Lỗi khoá trùng của MongoDB. Ở đây chỉ có thể là `uq_event_id`. */
const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoNotificationRepository implements NotificationRepository {
  constructor(
    @InjectModel(Notification.name) private readonly notifications: Model<Notification>,
    @InjectModel(NotificationRead.name) private readonly reads: Model<NotificationRead>,
  ) {}

  /**
   * Bắt lỗi khoá trùng thay vì "tìm trước rồi ghi": giữa hai lệnh đó có một khoảng trống
   * mà hai consumer chạy song song đều thấy "chưa có" và cùng ghi. Unique index thì không.
   */
  async create(eventId: string, content: NotificationContent): Promise<StoredNotification | null> {
    const createdAt = new Date();
    try {
      const saved = await this.notifications.create({
        eventId,
        type: content.type,
        title: content.title,
        message: content.message,
        audienceType: content.audienceType,
        audienceKey: content.audienceKey,
        referenceType: content.referenceType,
        referenceId: content.referenceId,
        actionLabel: content.actionLabel,
        actionUrl: content.actionUrl,
        metadata: content.metadata,
        createdAt,
      });
      return { id: saved._id.toString(), content, createdAt };
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return null;
      throw error;
    }
  }

  /**
   * Phân trang bằng con trỏ `createdAt` chứ không phải `skip`: thông báo mới được chèn
   * vào ĐẦU danh sách liên tục, nên `skip` sẽ khiến người dùng thấy lặp lại mục đã xem.
   */
  async list(viewer: Viewer, limit: number, before?: Date, types?: string[]): Promise<NotificationView[]> {
    const found = await this.notifications
      .find({
        ...addressedTo(viewer),
        ...typeFilter(types),
        ...(before ? { createdAt: { $lt: before } } : {}),
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    if (found.length === 0) return [];

    // Một truy vấn cho cả trang, không phải một truy vấn mỗi dòng.
    const readIds = new Set(
      (
        await this.reads
          .find({ userId: viewer.userId, notificationId: { $in: found.map((n) => n._id) } })
          .select({ notificationId: 1 })
          .lean()
      ).map((r) => r.notificationId.toString()),
    );

    return found.map((n) => ({
      id: n._id.toString(),
      type: n.type,
      title: n.title,
      message: n.message,
      referenceType: n.referenceType ?? null,
      referenceId: n.referenceId ?? null,
      actionLabel: n.actionLabel ?? null,
      actionUrl: n.actionUrl ?? null,
      metadata: n.metadata ?? {},
      createdAt: n.createdAt.toISOString(),
      read: readIds.has(n._id.toString()),
    }));
  }

  /**
   * Chưa đọc = số thông báo GỬI CHO NGƯỜI NÀY mà họ chưa đọc.
   *
   * Trước đây là phép trừ "tổng − đã đọc", đúng khi mọi thông báo đều `ALL`. Từ lúc có
   * thông báo theo vai trò và theo người, phép trừ ấy cho số âm-hoặc-thổi-phồng: một
   * giảng viên sẽ thấy chấm đỏ vì những thông báo gửi riêng cho admin mà họ không bao
   * giờ mở được. Đếm phải lọc theo ĐÚNG điều kiện của `list`, không có đường tắt.
   */
  async unreadCount(viewer: Viewer, types?: string[]): Promise<number> {
    const readIds = (
      await this.reads.find({ userId: viewer.userId }).select({ notificationId: 1 }).lean()
    ).map((r) => r.notificationId);

    return this.notifications.countDocuments({
      ...addressedTo(viewer),
      ...typeFilter(types),
      _id: { $nin: readIds },
    });
  }

  /** Bấm hai lần vào cùng một thông báo không được tạo hai dòng — nên là upsert. */
  async markRead(userId: string, notificationId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(notificationId)) return false;
    const exists = await this.notifications.exists({ _id: new Types.ObjectId(notificationId) });
    if (!exists) return false;

    await this.reads.updateOne(
      { userId, notificationId: new Types.ObjectId(notificationId) },
      { $setOnInsert: { readAt: new Date() } },
      { upsert: true },
    );
    return true;
  }

  /**
   * ponytail: nạp id của những thông báo chưa đọc rồi ghi một lượt. Với số thông báo ở
   * mức phase này (hàng chục) thì đủ. Khi danh sách lên tới hàng nghìn, đổi sang mốc
   * "đã đọc tới thời điểm T" cho mỗi user thay vì một dòng cho mỗi thông báo.
   */
  async markAllRead(viewer: Viewer, types?: string[]): Promise<number> {
    const readIds = (
      await this.reads.find({ userId: viewer.userId }).select({ notificationId: 1 }).lean()
    ).map((r) => r.notificationId);
    const unread = await this.notifications
      .find({ ...addressedTo(viewer), ...typeFilter(types), _id: { $nin: readIds } })
      .select({ _id: 1 })
      .lean();
    if (unread.length === 0) return 0;

    const readAt = new Date();
    await this.reads.bulkWrite(
      unread.map((n) => ({
        updateOne: {
          filter: { userId: viewer.userId, notificationId: n._id },
          update: { $setOnInsert: { readAt } },
          upsert: true,
        },
      })),
    );
    return unread.length;
  }
}

/**
 * Điều kiện "thông báo này gửi tới người đang hỏi".
 *
 * Một hàm dùng chung cho cả `list`, `unreadCount` và `markAllRead` chứ không chép ba lần:
 * ba bộ lọc lệch nhau sẽ cho ra chấm đỏ đếm những thông báo mà danh sách không hiện, và
 * người dùng không có cách nào làm nó tắt đi.
 */
function addressedTo(viewer: Viewer): Record<string, unknown> {
  return {
    $or: [
      { audienceType: 'ALL' },
      { audienceType: 'ROLE', audienceKey: viewer.role },
      { audienceType: 'USER', audienceKey: viewer.externalId },
    ],
  };
}

/**
 * Bỏ trống thì không lọc gì thêm — ứng dụng học viên đọc mọi loại nó được phép thấy.
 * Có giá trị thì CHỈ thu hẹp, không bao giờ mở rộng những gì `addressedTo` đã cho phép.
 */
function typeFilter(types?: string[]): Record<string, unknown> {
  return types && types.length > 0 ? { type: { $in: types } } : {};
}
