import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMAIL_PROVIDER,
  EmailDeliveryError,
  type EmailProvider,
} from '../domain/port/email-provider';
import { permitsEmail, type Reminder, type Recipient } from '../domain/model/reminder';
import { NotificationContent, type NotificationType } from '../domain/model/notification-content';
import { ReminderRepository } from '../infrastructure/reminder.repository';
import { RecordNotificationUseCase } from './record-notification.usecase';
import { renderEmail } from './email-template';

const INAPP_TYPES: Record<string, NotificationType> = {
  ASSIGNMENT_ASSIGNED: 'WORKSPACE_ASSIGNMENT_CREATED',
  DEADLINE_24H: 'WORKSPACE_ASSIGNMENT_DUE_SOON',
  DEADLINE_6H: 'WORKSPACE_ASSIGNMENT_DUE_SOON',
  ASSIGNMENT_OVERDUE: 'WORKSPACE_ASSIGNMENT_OVERDUE',
  RETRY_EXERCISE: 'WORKSPACE_ASSIGNMENT_RETRY',
  DEADLINE_CHANGED: 'WORKSPACE_DEADLINE_CHANGED',
  LEARNING_REMINDER: 'LEARNING_REMINDER',
  STUDY_SESSION_REMINDER: 'STUDY_SESSION_REMINDER',
  COURSE_COMPLETED: 'COURSE_COMPLETED',
  WORKSPACE_MEMBER_ADDED: 'WORKSPACE_MEMBER_ADDED',
};
@Injectable()
export class ReminderDispatcher implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(ReminderDispatcher.name);
  constructor(
    private readonly repo: ReminderRepository,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly record: RecordNotificationUseCase,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () => void this.run(),
      this.config.get<number>('REMINDER_POLL_SECONDS', 60) * 1000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.repo.recover();
      await this.repo.syncStudySchedules();
      for (let i = 0; i < 50; i++) {
        const r = await this.repo.claim();
        if (!r) break;
        await this.deliver(r);
      }
    } catch (e) {
      this.logger.error(
        'Reminder processing failed; durable queue retained',
        e instanceof Error ? e.name : 'unknown',
      );
    } finally {
      this.running = false;
    }
  }
  async deliver(r: Reminder) {
    const user = await this.repo.recipient(r.user_id);
    if (!user || user.status !== 'active') return this.repo.skip(r, user, 'RECIPIENT_UNAVAILABLE');
    if (!(await this.entityValid(r, user))) return;
    if (r.type === 'DEADLINE_6H' && user.preferences.deadline6hReminders !== true)
      return this.repo.skip(r, user, 'SIX_HOUR_REMINDER_DISABLED');
    const notificationType = INAPP_TYPES[r.type];
    if (notificationType && user.external_id) {
      await this.record.record(
        {
          eventId: r.id,
          eventName: 'reminder.due',
          occurredAt: new Date().toISOString(),
          correlationId: r.id,
          producer: 'notification-service',
          payload: {},
        },
        NotificationContent.create({
          type: notificationType,
          audienceType: 'USER',
          audienceKey: user.external_id,
          title: r.payload.title,
          message: r.payload.message,
          referenceType: r.entity_type === 'STUDY_SCHEDULE' ? null : r.entity_type === 'COURSE' ? 'COURSE' : 'WORKSPACE',
          referenceId: r.entity_type === 'STUDY_SCHEDULE' ? null : r.payload.referenceId ?? r.entity_id,
          actionUrl: r.payload.actionUrl,
          actionLabel: r.payload.actionLabel,
          metadata: { reminderId: r.id },
        }),
      );
    }
    if (!this.config.get<boolean>('SES_ENABLED')) return this.repo.skip(r, user, 'SES_DISABLED');
    if (!permitsEmail(user, r.type, r.category))
      return this.repo.skip(r, user, 'EMAIL_PREFERENCE_OR_VERIFICATION');
    const rendered = renderEmail(
      r.payload,
      user,
      this.config.get<string>('CLIENT_APP_URL', 'http://localhost:3000'),
    );
    if (!(await this.repo.startDelivery(r, user))) return;
    let messageId: string;
    try {
      const result = await this.provider.send({ recipient: user.email, ...rendered });
      messageId = result.messageId;
    } catch (error) {
      const e =
        error instanceof EmailDeliveryError
          ? error
          : new EmailDeliveryError('UNEXPECTED_SEND_ERROR', false, true);
      await this.repo.fail(r, e.code, e.retryable, e.ambiguous);
      return;
    }
    // Do not wrap this in the send catch: if DB fails after SES accepted, leave the
    // PROCESSING delivery for UNKNOWN recovery, never resend blindly.
    await this.repo.sent(r, messageId);
    // Keep batches moving while respecting the shared Sandbox-safe rate gate.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  private async entityValid(r: Reminder, user: Recipient): Promise<boolean> {
    if (r.entity_type === 'WORKSPACE_DOCUMENT') {
      if (!(await this.repo.workspaceDocumentEligible(r))) {
        await this.repo.skip(r, user, 'DOCUMENT_REMOVED_STATE_CHANGED_OR_PERMISSION_REVOKED');
        return false;
      }
    } else if (r.entity_type === 'STUDY_SCHEDULE') {
      if (!(await this.repo.studyScheduleValid(r))) {
        await this.repo.skip(r, user, 'STUDY_SCHEDULE_DISABLED_CHANGED_OR_EXPIRED');
        return false;
      }
    } else if (r.entity_type === 'ASSIGNMENT') {
      const a = await this.repo.assignment(r.entity_id);
      const outdatedDue =
        r.category === 'deadline' && a?.due_at?.toISOString() !== r.source_version;
      if (
        !a ||
        !a.eligible ||
        a.completed ||
        outdatedDue ||
        (r.type === 'RETRY_EXERCISE' && !a.allow_retry)
      ) {
        await this.repo.skip(r, user, 'ASSIGNMENT_COMPLETED_REMOVED_OR_CHANGED');
        return false;
      }
    } else if (r.entity_type === 'COURSE') {
      const c = await this.repo.learning(r.entity_id);
      if (
        !c ||
        !c.eligible ||
        (r.type === 'COURSE_COMPLETED' ? c.status !== 'completed' : c.status !== 'active')
      ) {
        await this.repo.skip(r, user, 'COURSE_NO_LONGER_ELIGIBLE');
        return false;
      }
      if (r.type === 'LEARNING_REMINDER') {
        if (c.last_activity_at.toISOString() !== r.source_version) {
          await this.repo.skip(r, user, 'LEARNING_RESUMED');
          return false;
        }
        const days =
          user.preferences.learningInactivityDays ??
          this.config.get<number>('LEARNING_INACTIVITY_DAYS', 3);
        const at = new Date(c.last_activity_at.getTime() + days * 86400000);
        if (at.getTime() > Date.now()) {
          await this.repo.defer(r, at);
          return false;
        }
      }
    } else if (r.entity_type === 'MEMBERSHIP') {
      if ((await this.repo.membership(r.entity_id))?.status !== 'active') {
        await this.repo.skip(r, user, 'MEMBERSHIP_REMOVED');
        return false;
      }
    }
    return true;
  }
}
