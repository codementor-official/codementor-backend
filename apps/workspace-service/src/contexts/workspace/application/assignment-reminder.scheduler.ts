import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TOPICS } from '@codementor/contracts';
import { EVENT_BUS, type EventBus } from '@codementor/messaging';
import {
  ASSIGNMENT_REMINDER_REPOSITORY,
  type AssignmentReminderRepository,
} from '../domain/port/assignment-reminder.repository';

const INTERVAL_MS = 15 * 60 * 1000;
const DUE_SOON_MS = 24 * 60 * 60 * 1000;
const OVERDUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AssignmentReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssignmentReminderScheduler.name);
  private interval: NodeJS.Timeout | null = null;
  private initial: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(ASSIGNMENT_REMINDER_REPOSITORY)
    private readonly reminders: AssignmentReminderRepository,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.initial = setTimeout(() => void this.run(), 5_000);
    this.interval = setInterval(() => void this.run(), INTERVAL_MS);
    this.initial.unref();
    this.interval.unref();
  }

  onModuleDestroy() {
    if (this.initial) clearTimeout(this.initial);
    if (this.interval) clearInterval(this.interval);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    const now = new Date();
    try {
      const reminders = await this.reminders.claim(
        now,
        new Date(now.getTime() + DUE_SOON_MS),
        new Date(now.getTime() - OVERDUE_WINDOW_MS),
        100,
      );
      for (const reminder of reminders) {
        try {
          await this.events.publish(TOPICS.ASSIGNMENT_REMINDER, {
            ...reminder,
            dueAt: reminder.dueAt.toISOString(),
          });
        } catch (error) {
          await this.reminders.release(reminder.assignmentId, reminder.kind);
          this.logger.error(`Không phát được reminder cho assignment ${reminder.assignmentId}`, error);
        }
      }
      if (reminders.length > 0) this.logger.log(`Đã phát ${reminders.length} nhắc việc Workspace`);
    } catch (error) {
      this.logger.error('Scheduler nhắc deadline thất bại', error);
    } finally {
      this.running = false;
    }
  }
}
