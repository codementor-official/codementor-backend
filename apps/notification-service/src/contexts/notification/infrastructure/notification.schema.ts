import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { NotificationType, ReferenceType } from '../domain/model/notification-content';

/**
 * Hình dạng collection do `codementor-infra/database/mongo/schemas/05-notifications.js`
 * và `06-notification-reads.js` quyết định — validator `$jsonSchema` ở đó mới là thứ
 * chặn dữ liệu sai. Khai báo dưới đây chỉ để TypeScript và Mongoose biết đường đọc/ghi.
 *
 * `autoIndex: false` được đặt ở MongoModule: index do infra tạo, ứng dụng không tự đổi.
 * Vì thế đừng thêm `index: true` ở đây — nó sẽ im lặng không có tác dụng và tạo ảo giác
 * rằng index đã tồn tại.
 */
@Schema({ collection: 'notifications', versionKey: false })
export class Notification {
  @Prop({ required: true })
  eventId!: string;

  @Prop({ required: true })
  type!: NotificationType;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ required: true, default: 'ALL' })
  audienceType!: 'ALL';

  @Prop({ type: String, default: null })
  referenceType!: ReferenceType | null;

  @Prop({ type: String, default: null })
  referenceId!: string | null;

  @Prop({ type: String, default: null })
  actionLabel!: string | null;

  @Prop({ type: String, default: null })
  actionUrl!: string | null;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ required: true })
  createdAt!: Date;
}

@Schema({ collection: 'notification_reads', versionKey: false })
export class NotificationRead {
  @Prop({ type: Types.ObjectId, required: true })
  notificationId!: Types.ObjectId;

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  readAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export type NotificationReadDocument = HydratedDocument<NotificationRead>;

export const NotificationSchema = SchemaFactory.createForClass(Notification);
export const NotificationReadSchema = SchemaFactory.createForClass(NotificationRead);
