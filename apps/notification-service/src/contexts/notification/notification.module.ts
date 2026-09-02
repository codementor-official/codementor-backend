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
  fromAssignmentReminder,
  fromArticlePublished,
  fromContentModerated,
  fromContentRemovalRequested,
  fromContentReviewRequested,
  fromCoursePublished,
  fromExercisePublished,
  fromRoadmapPublished,
  fromWorkspaceJoinReviewed,
  fromWorkspaceMessage,
} from './application/notification-content.factory';
import { NotificationController } from './presentation/notification.controller';
import { NotificationQuery } from './application/notification-query.usecase';
import { ReminderPlanner } from './application/reminder-planner';
import { ReminderDispatcher } from './application/reminder-dispatcher';
import { ReminderRepository } from './infrastructure/reminder.repository';
import { EMAIL_PROVIDER } from './domain/port/email-provider';
import { SesEmailProvider } from './infrastructure/ses-email.provider';
import { WorkspaceActivityRepository } from './infrastructure/workspace-activity.repository';
import { WorkspaceActivityNotifications } from './application/workspace-activity-notifications';

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
    ReminderPlanner,
    ReminderDispatcher,
    ReminderRepository,
    WorkspaceActivityRepository,
    WorkspaceActivityNotifications,
    { provide: EMAIL_PROVIDER, useClass: SesEmailProvider },
  ],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly consumer: EventConsumer,
    private readonly record: RecordNotificationUseCase,
    private readonly reminders: ReminderPlanner,
    private readonly workspaceActivity: WorkspaceActivityNotifications,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer
      .on(TOPICS.ASSIGNMENT_REVIEWED, (payload, envelope) => this.workspaceActivity.assignmentReviewed(payload, envelope), { replaySafe: true, fromBeginning: true })
      .on(TOPICS.WORKSPACE_ACTIVITY, (payload, envelope) => this.workspaceActivity.handle(payload, envelope), { replaySafe: true, fromBeginning: true })
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
      .on(
        TOPICS.ADMIN_ANNOUNCEMENT_CREATED,
        (payload, envelope) => this.record.record(envelope, fromAdminAnnouncement(payload)),
        { replaySafe: true },
      )
      .on(TOPICS.CONTENT_REVIEW_REQUESTED, (payload, envelope) =>
        this.record.record(envelope, fromContentReviewRequested(payload)),
      )
      .on(TOPICS.CONTENT_REMOVAL_REQUESTED, (payload, envelope) =>
        this.record.record(envelope, fromContentRemovalRequested(payload)),
      )
      .on(TOPICS.CONTENT_MODERATED, (payload, envelope) =>
        this.record.record(envelope, fromContentModerated(payload)),
      )
      .on(
        TOPICS.WORKSPACE_JOIN_REVIEWED,
        (payload, envelope) => this.record.record(envelope, fromWorkspaceJoinReviewed(payload)),
        { replaySafe: true },
      )
      .on(TOPICS.REMINDER_SOURCE_CHANGED, (payload) => this.reminders.source(payload), {
        replaySafe: true,
        fromBeginning: true,
      })
      .on(TOPICS.ASSIGNMENT_REMINDER, (payload, envelope) =>
        this.record.record(envelope, fromAssignmentReminder(payload)),
      )
      .on(TOPICS.WORKSPACE_MESSAGE_CREATED, async (payload, envelope) =>
        Promise.all(
          [...new Set(payload.recipientExternalIds)].map((externalId) =>
            this.record.record(
              { ...envelope, eventId: `${envelope.eventId}:${externalId}` },
              fromWorkspaceMessage(payload, externalId),
            ),
          ),
        ).then(() => undefined),
      );

    await this.consumer.start('notification-service');
  }
}
