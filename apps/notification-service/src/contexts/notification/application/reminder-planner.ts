import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EventEnvelope, ReminderSourceChangedV1 } from '@codementor/contracts';
import type { NotificationContent } from '../domain/model/notification-content';
import type { EmailCategory, EmailPayload, ReminderType } from '../domain/model/reminder';
import { ReminderRepository } from '../infrastructure/reminder.repository';
const HOUR = 3600000;
const DEADLINES = ['DEADLINE_24H', 'DEADLINE_6H', 'ASSIGNMENT_OVERDUE'];

@Injectable()
export class ReminderPlanner {
  constructor(
    private readonly repo: ReminderRepository,
    private readonly config: ConfigService,
  ) {}
  async allowsInApp(content: NotificationContent): Promise<boolean> {
    if (content.audienceType !== 'USER' || !content.audienceKey || !content.type.startsWith('WORKSPACE_')) return true;
    const user = await this.repo.recipientByExternalId(content.audienceKey);
    return Boolean(user && user.status === 'active' && user.workspace_enabled !== false);
  }
  async source(event: ReminderSourceChangedV1) {
    if (event.entityType === 'SETTINGS') {
      for (const c of await this.repo.coursesForUser(event.entityId))
        await this.course({ ...event, entityType: 'COURSE', entityId: c.id, change: 'SYNC' });
    } else if (event.entityType === 'GROUP_EXERCISE') {
      for (const a of await this.repo.assignmentsForExercise(event.entityId))
        await this.assignment(a.id, event);
    } else if (event.entityType === 'COURSE') await this.course(event);
    else if (event.entityType === 'MEMBERSHIP') {
      for (const a of await this.repo.assignmentsForMember(event.entityId))
        await this.assignment(a.id, { ...event, change: 'SYNC' });
      const member = await this.repo.membership(event.entityId);
      if (member?.status === 'active' && member.role !== 'owner' && event.change === 'INSERT')
        await this.repo.schedule({
          userId: member.user_id,
          type: 'WORKSPACE_MEMBER_ADDED',
          category: 'workspace',
          entityType: 'MEMBERSHIP',
          entityId: member.id,
          dedupeKey: 'member-added:' + member.id,
          scheduledAt: new Date(),
          payload: {
            title: 'Bạn đã được thêm vào nhóm học tập',
            message: `Bạn hiện là thành viên của “${member.name}”.`,
            actionUrl: '/workspace/' + member.slug,
            actionLabel: 'Mở nhóm học tập',
            referenceId: member.group_id,
          },
        });
    } else await this.assignment(event.entityId, event);
  }
  private async assignment(id: string, event: ReminderSourceChangedV1) {
    const a = await this.repo.assignment(id);
    if (!a || !a.eligible || a.completed) {
      await this.repo.cancel('ASSIGNMENT', id);
      return;
    }
    const path = `/workspace/${a.workspace_slug}?tab=exercises&groupExerciseId=${a.group_exercise_id}`;
    const base: EmailPayload = {
      title: '',
      message: `Bài “${a.exercise_title}” trong nhóm “${a.workspace_name}”.`,
      actionUrl: path,
      actionLabel: 'Mở bài tập',
      referenceId: a.group_id,
      ...(a.due_at ? { dueAt: a.due_at.toISOString() } : {}),
    };
    const enqueue = async (
      type: ReminderType,
      category: EmailCategory,
      title: string,
      at: Date,
      version: string,
      replace = false,
    ) => {
      await this.repo.schedule({
        userId: a.user_id,
        type,
        category,
        entityType: 'ASSIGNMENT',
        entityId: id,
        version,
        dedupeKey: id + ':' + type + ':' + version,
        scheduledAt: at,
        payload: { ...base, title },
        replace,
      });
    };
    if (event.entityType === 'ASSIGNMENT' && event.change === 'INSERT')
      await enqueue(
        'ASSIGNMENT_ASSIGNED',
        'assignment',
        'Bạn có bài tập mới',
        new Date(),
        'assigned',
      );
    if (!a.due_at) await this.repo.cancel('ASSIGNMENT', id, DEADLINES);
    else {
      const due = a.due_at.getTime(),
        version = a.due_at.toISOString();
      for (const [type, hours] of [
        ['DEADLINE_24H', 24],
        ['DEADLINE_6H', 6],
      ] as const) {
        if (due > Date.now())
          await enqueue(
            type,
            'deadline',
            'Bài tập sắp hết hạn',
            new Date(Math.max(Date.now(), due - hours * HOUR)),
            version,
            true,
          );
        else await this.repo.cancel('ASSIGNMENT', id, [type]);
      }
      // One overdue reminder per deadline; do not resurrect years-old demo assignments.
      if (due > Date.now() - 7 * 24 * HOUR)
        await enqueue(
          'ASSIGNMENT_OVERDUE',
          'deadline',
          'Bài tập đã quá hạn và chưa hoàn thành',
          new Date(due + 60000),
          version,
          true,
        );
      if (event.entityType === 'GROUP_EXERCISE' && event.deadlineChanged)
        await enqueue(
          'DEADLINE_CHANGED',
          'assignment',
          'Hạn nộp bài tập đã thay đổi',
          new Date(),
          event.changedAt,
        );
    }
    if (event.entityType === 'GROUP_EXERCISE' && event.deadlineChanged && !a.due_at)
      await enqueue(
        'DEADLINE_CHANGED',
        'assignment',
        'Bài tập đã được bỏ hạn nộp',
        new Date(),
        event.changedAt,
      );
    if (
      event.entityType === 'SUBMISSION' &&
      event.verdict !== 'accepted' &&
      event.submissionId &&
      a.allow_retry
    )
      await enqueue(
        'RETRY_EXERCISE',
        'assignment',
        'Bài nộp chưa đạt — hãy thử lại',
        new Date(Date.now() + HOUR),
        event.submissionId,
        true,
      );
    if (
      a.review_status === 'needsfix' &&
      event.entityType === 'ASSIGNMENT' &&
      event.change === 'UPDATE' &&
      a.allow_retry
    )
      await enqueue(
        'RETRY_EXERCISE',
        'assignment',
        'Bài nộp cần được chỉnh sửa',
        new Date(Date.now() + HOUR),
        event.changedAt,
        true,
      );
  }
  private async course(event: ReminderSourceChangedV1) {
    const c = await this.repo.learning(event.entityId);
    if (!c || !c.eligible || c.status !== 'active')
      await this.repo.cancel('COURSE', event.entityId, ['LEARNING_REMINDER']);
    if (!c || !c.eligible) return;
    const payload: EmailPayload = {
      title: 'Tiếp tục hành trình học tập',
      message: `Khóa học “${c.title}” đang chờ bạn tiếp tục.`,
      actionUrl: '/courses/' + c.course_id,
      actionLabel: 'Tiếp tục học',
      referenceId: c.course_id,
    };
    if (c.status === 'completed' && event.change !== 'SYNC') {
      await this.repo.schedule({
        userId: c.user_id,
        type: 'COURSE_COMPLETED',
        category: 'learning',
        entityType: 'COURSE',
        entityId: c.id,
        dedupeKey: 'course-completed:' + c.id,
        scheduledAt: new Date(),
        payload: {
          ...payload,
          title: 'Chúc mừng bạn đã hoàn thành khóa học',
          message: `Bạn đã hoàn thành “${c.title}”.`,
          actionLabel: 'Xem khóa học',
        },
      });
    } else if (c.status === 'active') {
      const user = await this.repo.recipient(c.user_id);
      const days =
        user?.preferences.learningInactivityDays ??
        this.config.get<number>('LEARNING_INACTIVITY_DAYS', 3);
      const version = c.last_activity_at.toISOString();
      await this.repo.schedule({
        userId: c.user_id,
        type: 'LEARNING_REMINDER',
        category: 'learning',
        entityType: 'COURSE',
        entityId: c.id,
        version,
        dedupeKey: 'learning:' + c.id + ':' + version,
        scheduledAt: new Date(c.last_activity_at.getTime() + days * 24 * HOUR),
        payload,
        replace: true,
      });
    }
  }
  async fromNotification(envelope: EventEnvelope<unknown>, content: NotificationContent) {
    // Explicit opt-in categories only. Chat still never generates email.
    const types: Record<string, ReminderType> = {
      WORKSPACE_JOIN_APPROVED: 'WORKSPACE_JOIN_APPROVED',
      WORKSPACE_JOIN_REJECTED: 'WORKSPACE_JOIN_REJECTED',
      WORKSPACE_DOCUMENT_PENDING: 'WORKSPACE_DOCUMENT_PENDING',
      WORKSPACE_DOCUMENT_PUBLISHED: 'WORKSPACE_DOCUMENT_PUBLISHED',
      WORKSPACE_DOCUMENT_REJECTED: 'WORKSPACE_DOCUMENT_REJECTED',
      WORKSPACE_EXERCISE_UPDATED: 'WORKSPACE_EXERCISE_UPDATED',
      ADMIN_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
    };
    const type = types[content.type];
    if (!type) return;
    const isDocument = type.startsWith('WORKSPACE_DOCUMENT_');
    const documentId = isDocument ? content.metadata.entityId : undefined;
    if (isDocument && (typeof documentId !== 'string' || !content.referenceId))
      throw new Error('Workspace document notification requires document and workspace references');
    const enqueue = async (userId: string) =>
      this.repo.schedule({
        userId,
        type,
        category: type === 'SYSTEM_ANNOUNCEMENT' ? 'system' : 'workspace',
        entityType: isDocument ? 'WORKSPACE_DOCUMENT' : 'NOTIFICATION',
        entityId: isDocument ? documentId as string : envelope.eventId,
        dedupeKey: 'notification:' + envelope.eventId + ':' + userId,
        scheduledAt: new Date(),
        payload: {
          title: content.title,
          message: content.message,
          actionUrl: content.actionUrl ?? '/profile?tab=settings',
          actionLabel: content.actionLabel ?? 'Mở CodeMentor',
          ...(content.referenceId ? { referenceId: content.referenceId } : {}),
        },
      });
    if (content.audienceType === 'USER' && content.audienceKey) {
      const user = await this.repo.recipientByExternalId(content.audienceKey);
      if (user) await enqueue(user.id);
    } else if (content.audienceType === 'ALL' && type === 'SYSTEM_ANNOUNCEMENT') {
      let after: string | null = null;
      for (;;) {
        const page = await this.repo.recipients(after);
        for (const user of page) await enqueue(user.id);
        if (page.length < 100) break;
        after = page[page.length - 1].id;
      }
    }
  }
}
