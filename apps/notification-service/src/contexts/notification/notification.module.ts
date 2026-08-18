import { Module, type OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventConsumer } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import {
  Notification,
  NotificationRead,
  NotificationReadSchema,
  NotificationSchema,
} from './infrastructure/notification.schema';
import { NOTIFICATION_REPOSITORY } from './domain/port/notification.repository';
import { MongoNotificationRepository } from './infrastructure/mongo-notification.repository';
import { RecordNotificationUseCase } from './application/record-notification.usecase';
import {
  fromAdminAnnouncement,
  fromArticlePublished,
  fromContentModerated,
  fromContentReviewRequested,
  fromCoursePublished,
  fromExercisePublished,
  fromRoadmapPublished,
} from './application/notification-content.factory';
import { NotificationController } from './presentation/notification.controller';
import { NotificationQuery } from './application/notification-query.usecase';

/**
 * Bốn sự kiện, một cách xử lý: dịch payload sang nội dung rồi giao cho
 * `RecordNotificationUseCase`. Thêm loại thông báo mới = thêm một hàm dịch trong
 * `notification-content.factory.ts` và một dòng `on(...)` ở đây.
 *
 * Khử trùng lặp do `EventConsumer` lo (bảng `processed_events`, khoá theo tên consumer);
 * unique index `eventId` trong Mongo là chốt thứ hai. Không tự viết thêm cơ chế thứ ba.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationRead.name, schema: NotificationReadSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    { provide: NOTIFICATION_REPOSITORY, useClass: MongoNotificationRepository },
    RecordNotificationUseCase,
    NotificationQuery,
  ],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly consumer: EventConsumer,
    private readonly record: RecordNotificationUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer
      .on(TOPICS.COURSE_PUBLISHED, (payload, envelope) =>
        this.record.record(envelope, fromCoursePublished(payload)),
      )
      .on(TOPICS.EXERCISE_PUBLISHED, (payload, envelope) =>
        this.record.record(envelope, fromExercisePublished(payload)),
      )
      .on(TOPICS.ROADMAP_PUBLISHED, (payload, envelope) =>
        this.record.record(envelope, fromRoadmapPublished(payload)),
      )
      .on(TOPICS.ARTICLE_PUBLISHED, (payload, envelope) =>
        this.record.record(envelope, fromArticlePublished(payload)),
      )
      .on(TOPICS.ADMIN_ANNOUNCEMENT_CREATED, (payload, envelope) =>
        this.record.record(envelope, fromAdminAnnouncement(payload)),
      )
      .on(TOPICS.CONTENT_REVIEW_REQUESTED, (payload, envelope) =>
        this.record.record(envelope, fromContentReviewRequested(payload)),
      )
      .on(TOPICS.CONTENT_MODERATED, (payload, envelope) =>
        this.record.record(envelope, fromContentModerated(payload)),
      );

    await this.consumer.start('notification-service');
  }
}
