import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@codementor/platform';
import type {
  EmailCategory,
  EmailPayload,
  Recipient,
  Reminder,
  ReminderType,
} from '../domain/model/reminder';

export interface AssignmentContext {
  id: string;
  user_id: string;
  group_id: string;
  group_exercise_id: string;
  workspace_slug: string;
  workspace_name: string;
  exercise_title: string;
  exercise_id: string;
  due_at: Date | null;
  allow_retry: boolean;
  completed: boolean;
  eligible: boolean;
  review_status: string;
}
export interface LearningContext {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  status: string;
  last_activity_at: Date;
  eligible: boolean;
}
export interface MembershipContext {
  id: string;
  user_id: string;
  group_id: string;
  slug: string;
  name: string;
  role: string;
  status: string;
}
export interface ScheduleInput {
  userId: string;
  type: ReminderType;
  category: EmailCategory;
  entityType: string;
  entityId: string;
  version?: string;
  dedupeKey: string;
  scheduledAt: Date;
  payload: EmailPayload;
  replace?: boolean;
}

@Injectable()
export class ReminderRepository {
  constructor(private readonly db: PrismaService) {}
  async workspaceDocumentEligible(r: Reminder): Promise<boolean> {
    if (!r.payload.referenceId) return false;
    const [row] = await this.db.$queryRawUnsafe<{ eligible: boolean }[]>(
      `SELECT EXISTS (
        SELECT 1 FROM notification_workspace_document_context d
        JOIN notification_workspace_member_context m ON m.group_id=d.group_id
        WHERE d.id=$1::uuid AND d.group_id=$2::uuid AND m.user_id=$3::uuid
          AND m.status='active' AND d.deleted_at IS NULL
          AND CASE $4::text
            WHEN 'WORKSPACE_DOCUMENT_PENDING' THEN d.status='pending' AND m.can_view_doc AND m.can_approve_doc AND m.user_id IS DISTINCT FROM d.uploader_id
            WHEN 'WORKSPACE_DOCUMENT_PUBLISHED' THEN d.status='published' AND m.can_view_doc
            WHEN 'WORKSPACE_DOCUMENT_REJECTED' THEN d.status='hidden' AND m.user_id=d.uploader_id
            ELSE false END
      ) AS eligible`, r.entity_id, r.payload.referenceId, r.user_id, r.type,
    );
    return row.eligible;
  }
  async syncStudySchedules(at = new Date()) {
    // One set-based scan per poll, not a timer/job per user. Unique dedupe_key also
    // protects concurrent workers/restarts. Each saved slot can notify once per local day.
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE notification_reminders r SET
        status='CANCELLED',cancelled_at=now(),updated_at=now()
        WHERE r.entity_type='STUDY_SCHEDULE' AND r.status IN ('PENDING','FAILED')
          AND NOT EXISTS (SELECT 1 FROM notification_study_schedule_due($1::timestamptz) s
            WHERE s.user_id=r.user_id AND s.user_id::text || ':' || s.weekday=r.entity_id
              AND s.version=r.source_version)`, at);
      await tx.$executeRawUnsafe(`INSERT INTO notification_reminders
        (user_id,type,category,entity_type,entity_id,dedupe_key,source_version,scheduled_at,payload)
        SELECT user_id,'STUDY_SESSION_REMINDER','learning','STUDY_SCHEDULE',
          user_id::text || ':' || weekday,'study:' || user_id::text || ':' || local_date::text,
          version,due_at,jsonb_build_object(
            'title','Đến giờ học theo lịch của bạn',
            'message','Buổi học lúc ' || to_char(start_time,'HH24:MI') || ' (' || timezone ||
              '), thời lượng ' || duration_minutes::text || ' phút. Hãy dành thời gian cho mục tiêu học tập hôm nay.',
            'actionUrl','/profile?tab=personalization','actionLabel','Xem lịch học')
        FROM notification_study_schedule_due($1::timestamptz)
        ON CONFLICT(dedupe_key) DO UPDATE SET status='PENDING',cancelled_at=NULL,
          source_version=EXCLUDED.source_version,scheduled_at=EXCLUDED.scheduled_at,
          payload=EXCLUDED.payload,updated_at=now()
        WHERE notification_reminders.status IN ('PENDING','CANCELLED')
          AND (notification_reminders.status='CANCELLED' OR notification_reminders.source_version IS DISTINCT FROM EXCLUDED.source_version)
          AND NOT EXISTS (SELECT 1 FROM email_deliveries d WHERE d.reminder_id=notification_reminders.id)`, at);
    });
  }
  async studyScheduleValid(r: Reminder, at = new Date()): Promise<boolean> {
    const [row] = await this.db.$queryRawUnsafe<{ valid: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM notification_study_schedule_due($1::timestamptz) s
        WHERE s.user_id=$2::uuid AND s.user_id::text || ':' || s.weekday=$3
          AND s.version=$4) AS valid`, at, r.user_id, r.entity_id, r.source_version,
    );
    return row.valid;
  }
  async recipient(id: string): Promise<Recipient | undefined> {
    return (
      await this.db.$queryRawUnsafe<Recipient[]>(
        'SELECT * FROM notification_recipient_context WHERE id=$1::uuid',
        id,
      )
    )[0];
  }
  async recipientByExternalId(id: string): Promise<Recipient | undefined> {
    return (
      await this.db.$queryRawUnsafe<Recipient[]>(
        'SELECT * FROM notification_recipient_context WHERE external_id=$1',
        id,
      )
    )[0];
  }
  async recipients(after: string | null, limit = 100): Promise<Recipient[]> {
    return this.db.$queryRawUnsafe(
      "SELECT * FROM notification_recipient_context WHERE ($1::uuid IS NULL OR id>$1::uuid) AND status='active' AND email_enabled ORDER BY id LIMIT $2",
      after,
      limit,
    );
  }
  async assignment(id: string): Promise<AssignmentContext | undefined> {
    return (
      await this.db.$queryRawUnsafe<AssignmentContext[]>(
        'SELECT * FROM notification_assignment_context WHERE id=$1::uuid',
        id,
      )
    )[0];
  }
  assignmentsForExercise(id: string): Promise<AssignmentContext[]> {
    return this.db.$queryRawUnsafe(
      'SELECT * FROM notification_assignment_context WHERE group_exercise_id=$1::uuid',
      id,
    );
  }
  assignmentsForMember(id: string): Promise<AssignmentContext[]> {
    return this.db.$queryRawUnsafe(
      'SELECT * FROM notification_assignment_context WHERE member_id=$1::uuid',
      id,
    );
  }
  async learning(id: string): Promise<LearningContext | undefined> {
    return (
      await this.db.$queryRawUnsafe<LearningContext[]>(
        'SELECT * FROM notification_learning_context WHERE id=$1::uuid',
        id,
      )
    )[0];
  }
  coursesForUser(id: string): Promise<LearningContext[]> {
    return this.db.$queryRawUnsafe(
      "SELECT * FROM notification_learning_context WHERE user_id=$1::uuid AND status='active'",
      id,
    );
  }
  async membership(id: string): Promise<MembershipContext | undefined> {
    return (
      await this.db.$queryRawUnsafe<MembershipContext[]>(
        'SELECT * FROM notification_workspace_context WHERE id=$1::uuid',
        id,
      )
    )[0];
  }
  async schedule(input: ScheduleInput) {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        input.userId + input.entityType + input.entityId + input.type,
      );
      // Delayed events must not replace a schedule based on newer source data.
      if (input.entityType === 'ASSIGNMENT') {
        const [current] = await tx.$queryRawUnsafe<{ valid: boolean }[]>(
          `SELECT EXISTS(SELECT 1 FROM notification_assignment_context WHERE id=$1::uuid
            AND eligible AND NOT completed AND ($2::text<>'deadline' OR date_trunc('milliseconds',due_at)=$3::timestamptz)) AS valid`,
          input.entityId,
          input.category,
          input.category === 'deadline' ? input.version : null,
        );
        if (!current.valid) return;
      }
      if (input.entityType === 'COURSE' && input.type === 'LEARNING_REMINDER') {
        const [current] = await tx.$queryRawUnsafe<{ valid: boolean }[]>(
          `SELECT EXISTS(SELECT 1 FROM notification_learning_context WHERE id=$1::uuid
            AND eligible AND status='active' AND date_trunc('milliseconds',last_activity_at)=$2::timestamptz) AS valid`,
          input.entityId,
          input.version,
        );
        if (!current.valid) return;
      }
      if (input.replace)
        await tx.$executeRawUnsafe(
          `
       UPDATE notification_reminders SET status='CANCELLED',cancelled_at=now(),updated_at=now()
       WHERE user_id=$1::uuid AND entity_type=$2 AND entity_id=$3 AND type=$4
         AND dedupe_key<>$5 AND status IN ('PENDING','FAILED','PROCESSING')`,
          input.userId,
          input.entityType,
          input.entityId,
          input.type,
          input.dedupeKey,
        );
      await tx.$executeRawUnsafe(
        `
       INSERT INTO notification_reminders(user_id,type,category,entity_type,entity_id,source_version,dedupe_key,scheduled_at,payload)
       VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(dedupe_key) DO UPDATE SET
       status='PENDING',cancelled_at=NULL,scheduled_at=EXCLUDED.scheduled_at,payload=EXCLUDED.payload,updated_at=now()
       WHERE notification_reminders.status IN ('CANCELLED','PENDING') AND $10
         AND NOT EXISTS(SELECT 1 FROM email_deliveries d WHERE d.reminder_id=notification_reminders.id)`,
        input.userId,
        input.type,
        input.category,
        input.entityType,
        input.entityId,
        input.version ?? null,
        input.dedupeKey,
        input.scheduledAt,
        JSON.stringify(input.payload),
        input.replace ?? false,
      );
    });
  }
  async cancel(entityType: string, entityId: string, types?: string[]) {
    await this.db.$executeRawUnsafe(
      `UPDATE notification_reminders SET status='CANCELLED',cancelled_at=now(),updated_at=now()
     WHERE entity_type=$1 AND entity_id=$2 AND status IN ('PENDING','PROCESSING','FAILED')
     AND ($3::text[] IS NULL OR type=ANY($3::text[]))`,
      entityType,
      entityId,
      types ?? null,
    );
  }
  async recover() {
    // A dead worker that never started a send can be reclaimed. Once send began,
    // its result is ambiguous: never auto-send again just because the lease expired.
    await this.db.$executeRawUnsafe(`UPDATE notification_reminders r SET
      status=CASE WHEN EXISTS(SELECT 1 FROM email_deliveries d WHERE d.reminder_id=r.id AND d.status='PROCESSING') THEN 'FAILED' ELSE 'PENDING' END,
      retryable=NOT EXISTS(SELECT 1 FROM email_deliveries d WHERE d.reminder_id=r.id AND d.status='PROCESSING'),
      processing_token=NULL, updated_at=now()
      WHERE r.status='PROCESSING' AND r.locked_at<now()-interval '5 minutes'`);
    await this.db
      .$executeRawUnsafe(`UPDATE email_deliveries d SET status='UNKNOWN',error_message='WORKER_STOPPED_DURING_SEND',updated_at=now()
     FROM notification_reminders r WHERE d.reminder_id=r.id AND d.status='PROCESSING' AND r.status='FAILED' AND NOT r.retryable`);
  }
  async claim(): Promise<Reminder | undefined> {
    const token = randomUUID();
    const rows = await this.db.$queryRawUnsafe<Reminder[]>(
      `WITH picked AS (
     SELECT id FROM notification_reminders WHERE scheduled_at<=now() AND
       (status='PENDING' OR (status='FAILED' AND retryable AND retry_count<3))
     ORDER BY scheduled_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
     UPDATE notification_reminders r SET status='PROCESSING',processing_token=$1::uuid,locked_at=now(),updated_at=now()
     FROM picked WHERE r.id=picked.id RETURNING r.*`,
      token,
    );
    return rows[0];
  }
  async startDelivery(r: Reminder, user: Recipient): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      // One global SES send per second across workers (Sandbox-safe).
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('codementor-ses-rate'))");
      const recent = await tx.$queryRawUnsafe<
        { busy: boolean }[]
      >(`SELECT EXISTS(SELECT 1 FROM email_deliveries
       WHERE status<>'SKIPPED' AND updated_at>now()-interval '1.1 seconds') AS busy`);
      if (recent[0]?.busy) {
        await tx.$executeRawUnsafe(
          `UPDATE notification_reminders SET status='PENDING',scheduled_at=now()+interval '2 seconds'
         WHERE id=$1::uuid AND processing_token=$2::uuid AND status='PROCESSING'`,
          r.id,
          r.processing_token,
        );
        return false;
      }
      const inserted = await tx.$executeRawUnsafe(
        `INSERT INTO email_deliveries(user_id,notification_id,reminder_id,recipient,template,status,attempt_count)
       SELECT user_id,$3,id,$4,type,'PROCESSING',1 FROM notification_reminders
       WHERE id=$1::uuid AND processing_token=$2::uuid AND status='PROCESSING'
       ON CONFLICT(reminder_id) DO UPDATE SET status='PROCESSING',attempt_count=email_deliveries.attempt_count+1,
         updated_at=now(),recipient=EXCLUDED.recipient,error_message=NULL
       WHERE email_deliveries.status='FAILED'`,
        r.id,
        r.processing_token,
        r.payload.notificationId ?? null,
        user.email,
      );
      return inserted > 0;
    });
  }
  async sent(r: Reminder, messageId: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "UPDATE email_deliveries SET status='SENT',provider_message_id=$2,sent_at=now(),updated_at=now() WHERE reminder_id=$1::uuid",
        r.id,
        messageId,
      );
      await tx.$executeRawUnsafe(
        "UPDATE notification_reminders SET status='SENT',sent_at=now(),updated_at=now() WHERE id=$1::uuid AND processing_token=$2::uuid",
        r.id,
        r.processing_token,
      );
    });
  }
  async fail(r: Reminder, code: string, retryable: boolean, ambiguous: boolean) {
    await this.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'UPDATE email_deliveries SET status=$2,error_message=$3,updated_at=now() WHERE reminder_id=$1::uuid',
        r.id,
        ambiguous ? 'UNKNOWN' : 'FAILED',
        code,
      );
      await tx.$executeRawUnsafe(
        `UPDATE notification_reminders SET status='FAILED',retry_count=LEAST(retry_count+1,3),
       retryable=$3, scheduled_at=now()+($4*interval '1 second'),updated_at=now()
       WHERE id=$1::uuid AND processing_token=$2::uuid AND status='PROCESSING'`,
        r.id,
        r.processing_token,
        retryable && !ambiguous,
        60 * Math.pow(2, r.retry_count),
      );
    });
  }
  async skip(r: Reminder, user: Recipient | undefined, reason: string) {
    await this.db.$transaction(async (tx) => {
      if (user)
        await tx.$executeRawUnsafe(
          `INSERT INTO email_deliveries(user_id,reminder_id,recipient,template,status,error_message)
       VALUES($1::uuid,$2::uuid,$3,$4,'SKIPPED',$5) ON CONFLICT(reminder_id) DO NOTHING`,
          r.user_id,
          r.id,
          user.email,
          r.type,
          reason,
        );
      await tx.$executeRawUnsafe(
        `UPDATE notification_reminders SET status='CANCELLED',cancelled_at=now(),updated_at=now()
       WHERE id=$1::uuid AND processing_token=$2::uuid AND status='PROCESSING'`,
        r.id,
        r.processing_token,
      );
    });
  }
  async defer(r: Reminder, at: Date) {
    await this.db.$executeRawUnsafe(
      "UPDATE notification_reminders SET status='PENDING',scheduled_at=$3,updated_at=now() WHERE id=$1::uuid AND processing_token=$2::uuid AND status='PROCESSING'",
      r.id,
      r.processing_token,
      at,
    );
  }
  async list(userId: string, page: number, limit: number) {
    const [items, [count]] = await Promise.all([
      this.db.$queryRawUnsafe(
        `SELECT id,type,category,entity_type AS "entityType",entity_id AS "entityId",scheduled_at AS "scheduledAt",
       status,payload,sent_at AS "sentAt",cancelled_at AS "cancelledAt",retry_count AS "retryCount"
       FROM notification_reminders WHERE user_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
        userId,
        limit,
        (page - 1) * limit,
      ),
      this.db.$queryRawUnsafe<{ total: number }[]>(
        'SELECT count(*)::int AS total FROM notification_reminders WHERE user_id=$1::uuid',
        userId,
      ),
    ]);
    return { items, page, limit, total: count.total, totalPages: Math.ceil(count.total / limit) };
  }
}
