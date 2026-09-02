// Real PostgreSQL + Kafka + Mongo integration. Sends five emails to the
// SES mailbox simulator only with --ses; otherwise uses a recording provider.
// Run when notification-service is stopped; this boots its real Nest context.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { MongoClient } from 'mongodb';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

if (process.env.NODE_ENV === 'production')
  throw new Error('Integration fixtures are dev/test only');
process.env.REMINDER_POLL_SECONDS = '3600'; // Never dispatch unrelated queued reminders.
process.env.SES_ENABLED = 'true';
const root = '../dist/apps/notification-service/';
const load = (path) => import(root + path + '.js');
const { AppModule } = await load('apps/notification-service/src/app.module');
const ctx = 'apps/notification-service/src/contexts/notification/';
const { ReminderRepository } = await load(ctx + 'infrastructure/reminder.repository');
const { ReminderPlanner } = await load(ctx + 'application/reminder-planner');
const { ReminderDispatcher } = await load(ctx + 'application/reminder-dispatcher');
const { RecordNotificationUseCase } = await load(ctx + 'application/record-notification.usecase');
const { EMAIL_PROVIDER, EmailDeliveryError } = await load(ctx + 'domain/port/email-provider');
const { KafkaClient } = await load('libs/messaging/src/kafka.client');
const db = new PrismaClient(),
  mongo = new MongoClient(process.env.MONGO_URI);
const fixed = (n) => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = {
  user: fixed(1),
  group: fixed(2),
  member: fixed(3),
  exercise: fixed(4),
  groupExercise: fixed(5),
  assignment: fixed(6),
  enrollment: fixed(7),
  uploader: fixed(8),
  uploaderMember: fixed(9),
  document: fixed(10),
};
const fixtureIds = Object.values(ids);
let app,
  created = false;
const ownEventIds = new Set();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let n = 0; n < 100; n++) {
    const value = await check();
    if (value) return value;
    await wait(200);
  }
  throw new Error('Timed out: ' + label);
}
async function rows(type) {
  return db.$queryRawUnsafe(
    'SELECT * FROM notification_reminders WHERE user_id=$1::uuid AND ($2::text IS NULL OR type=$2) ORDER BY created_at,id',
    ids.user,
    type ?? null,
  );
}
try {
  assert.equal(
    await db.users.findUnique({ where: { id: ids.user } }),
    null,
    'Fixture ID already exists; do not overwrite it',
  );
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const repo = app.get(ReminderRepository),
    planner = app.get(ReminderPlanner),
    record = app.get(RecordNotificationUseCase),
    config = app.get(ConfigService);
  const kafka = app.get(KafkaClient);
  await mongo.connect();
  const notifications = mongo.db(process.env.MONGO_DB || 'codementor').collection('notifications');
  let calls = 0;
  const realProvider = app.get(EMAIL_PROVIDER);
  const provider = {
    send: async (input) => {
      assert.equal(input.recipient, 'success@simulator.amazonses.com');
      calls++;
      return process.argv.includes('--ses')
        ? realProvider.send(input)
        : { messageId: 'fixture-' + calls };
    },
  };
  const dispatcher = new ReminderDispatcher(repo, config, provider, record);
  async function publishChanges() {
    const outbox = await db.$queryRawUnsafe(
      `SELECT * FROM outbox WHERE published_at IS NULL AND topic='evt.reminder.source-changed.v1'
     AND payload->'payload'->>'entityId'=ANY($1::text[]) ORDER BY created_at,id`,
      fixtureIds,
    );
    for (const item of outbox) {
      ownEventIds.add(item.id);
      await kafka.producer.send({
        topic: item.topic,
        messages: [{ key: item.partition_key, value: JSON.stringify(item.payload) }],
      });
      await db.$executeRawUnsafe('UPDATE outbox SET published_at=now() WHERE id=$1::uuid', item.id);
    }
  }
  async function claimOwn(id) {
    return (
      await db.$queryRawUnsafe(
        `UPDATE notification_reminders SET status='PROCESSING',locked_at=now(),processing_token=$2::uuid
     WHERE id=$1::uuid AND (status='PENDING' OR (status='FAILED' AND retryable AND retry_count<3)) RETURNING *`,
        id,
        randomUUID(),
      )
    )[0];
  }
  async function deliver(type, worker = dispatcher) {
    const r = (await rows(type)).find((x) => x.status === 'PENDING' || x.status === 'FAILED');
    assert.ok(r, 'Missing ' + type);
    // This targeted fixture dispatch intentionally advances future schedules.
    await worker.deliver(await claimOwn(r.id));
    return r.id;
  }
  await db.$transaction(async (tx) => {
    await tx.users.create({
      data: {
        id: ids.user,
        email: 'success@simulator.amazonses.com',
        display_name: 'SES Reminder Fixture',
        external_id: 'ses-reminder-fixture',
        email_verified_at: new Date(),
      },
    });
    await tx.study_groups.create({
      data: {
        id: ids.group,
        slug: 'ses-reminder-fixture',
        name: 'Kiểm thử nhắc bài Binary Search',
        invite_code: 'SESFIXTURE1',
        owner_id: ids.user,
        privacy: 'private',
      },
    });
    await tx.group_members.create({
      data: { id: ids.member, group_id: ids.group, user_id: ids.user, role: 'owner' },
    });
    await tx.exercises.create({
      data: {
        id: ids.exercise,
        slug: 'ses-reminder-fixture',
        title: 'Binary Search reminder fixture',
        difficulty: 'easy',
        visibility: 'group',
      },
    });
    await tx.group_exercises.create({
      data: {
        id: ids.groupExercise,
        group_id: ids.group,
        exercise_id: ids.exercise,
        due_at: new Date(Date.now() + 24 * 3600000),
      },
    });
    await tx.assignments.create({
      data: {
        id: ids.assignment,
        group_id: ids.group,
        group_exercise_id: ids.groupExercise,
        member_id: ids.member,
      },
    });
  });
  created = true;
  await publishChanges();
  await until(async () => (await rows()).length === 4, 'Kafka plans assignment and deadlines');
  const assignedId = await deliver('ASSIGNMENT_ASSIGNED');
  const deadlineId = await deliver('DEADLINE_24H');
  assert.equal(calls, 2);
  assert.equal(
    await notifications.countDocuments({ eventId: { $in: [assignedId, deadlineId] } }),
    2,
  );
  const delivered = await db.$queryRawUnsafe(
    "SELECT * FROM email_deliveries WHERE user_id=$1::uuid AND status='SENT'",
    ids.user,
  );
  assert.equal(delivered.length, 2);
  assert.ok(delivered.every((d) => d.provider_message_id));
  await planner.source({
    entityType: 'ASSIGNMENT',
    entityId: ids.assignment,
    change: 'INSERT',
    changedAt: new Date().toISOString(),
  });
  assert.equal((await rows('ASSIGNMENT_ASSIGNED')).length, 1);
  assert.equal(await claimOwn(assignedId), undefined);
  console.log(
    'PASS assignment -> SQL outbox -> Kafka -> notification -> in-app + email; replay does not duplicate',
  );

  await db.group_exercises.update({
    where: { id: ids.groupExercise },
    data: { due_at: new Date(Date.now() + 48 * 3600000) },
  });
  await publishChanges();
  await until(async () => (await rows('DEADLINE_CHANGED')).length === 1, 'deadline changed');
  assert.equal((await rows('ASSIGNMENT_OVERDUE')).filter((x) => x.status === 'PENDING').length, 1);
  await db.$executeRawUnsafe(
    `INSERT INTO user_settings(user_id,email_preferences) VALUES($1::uuid,'{"deadlineReminders":false}')
   ON CONFLICT(user_id) DO UPDATE SET email_preferences=EXCLUDED.email_preferences`,
    ids.user,
  );
  await deliver('DEADLINE_24H');
  assert.equal(calls, 2);
  assert.ok((await rows('DEADLINE_24H')).some((x) => x.status === 'CANCELLED'));
  console.log('PASS deadline replacement and persisted email opt-out (in-app retained)');

  await db.assignments.update({
    where: { id: ids.assignment },
    data: { status: 'done', review_status: 'approved', reviewed_by: ids.user, reviewed_at: new Date() },
  });
  await publishChanges();
  await until(
    async () => !(await rows()).some((x) => ['PENDING', 'PROCESSING', 'FAILED'].includes(x.status)),
    'completion cancels remaining reminders',
  );
  console.log('PASS assignment completion cancels every pending reminder');

  const course = await db.courses.findFirst({
    where: { status: 'published' },
    select: { id: true },
  });
  if (course) {
    await db.course_enrollments.create({
      data: {
        id: ids.enrollment,
        user_id: ids.user,
        course_id: course.id,
        last_activity_at: new Date(Date.now() - 4 * 86400000),
      },
    });
    await publishChanges();
    await until(async () => (await rows('LEARNING_REMINDER')).length === 1, 'learning inactivity');
    await db.course_enrollments.update({
      where: { id: ids.enrollment },
      data: { status: 'completed', completed_at: new Date() },
    });
    await publishChanges();
    await until(async () => (await rows('COURSE_COMPLETED')).length === 1, 'course completed');
    assert.equal((await rows('LEARNING_REMINDER'))[0].status, 'CANCELLED');
    console.log('PASS learning inactivity and course completion');
  }
  const schedule = (key) =>
    repo.schedule({
      userId: ids.user,
      type: 'SYSTEM_ANNOUNCEMENT',
      category: 'system',
      entityType: 'NOTIFICATION',
      entityId: key,
      dedupeKey: key,
      scheduledAt: new Date(),
      payload: {
        title: 'SES failure fixture',
        message: 'Only the simulator fixture.',
        actionUrl: '/profile',
        actionLabel: 'Profile',
      },
    });
  await schedule('ses-fixture-retry');
  await wait(1200);
  let retryCalls = 0;
  const retryProvider = {
    send: async () => {
      retryCalls++;
      if (retryCalls === 1) throw new EmailDeliveryError('TooManyRequestsException', true);
      return { messageId: 'retry-success-fixture' };
    },
  };
  const retryWorker = new ReminderDispatcher(repo, config, retryProvider, record);
  const retryId = await deliver('SYSTEM_ANNOUNCEMENT', retryWorker);
  assert.equal((await rows('SYSTEM_ANNOUNCEMENT'))[0].status, 'FAILED');
  await wait(1200);
  await retryWorker.deliver(await claimOwn(retryId));
  assert.equal(retryCalls, 2);
  assert.equal(await claimOwn(retryId), undefined);
  const retryLog = await db.$queryRawUnsafe(
    'SELECT * FROM email_deliveries WHERE reminder_id=$1::uuid',
    retryId,
  );
  assert.equal(retryLog.length, 1);
  assert.equal(retryLog[0].attempt_count, 2);
  assert.equal(retryLog[0].status, 'SENT');
  console.log('PASS SES temporary rejection retries with one durable delivery record');
  await schedule('ses-fixture-ambiguous');
  const uncertainWorker = new ReminderDispatcher(
    repo,
    config,
    {
      send: async () => {
        throw new EmailDeliveryError('TimeoutError', false, true);
      },
    },
    record,
  );
  const uncertainId = await deliver('SYSTEM_ANNOUNCEMENT', uncertainWorker);
  assert.equal(await claimOwn(uncertainId), undefined);
  const [unknown] = await db.$queryRawUnsafe(
    'SELECT status FROM email_deliveries WHERE reminder_id=$1::uuid',
    uncertainId,
  );
  assert.equal(unknown.status, 'UNKNOWN');
  console.log('PASS uncertain SES acceptance never automatically resends');
  const before = (await rows()).length;
  await planner.fromNotification({ eventId: randomUUID() }, { type: 'WORKSPACE_CHAT_MESSAGE' });
  assert.equal((await rows()).length, before);
  console.log('PASS chat produces no email');
  // Calendar email uses a real saved weekly slot and checks it again at dispatch.
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (type) => local.find((item) => item.type === type).value;
  const weekday = part('weekday').toLowerCase();
  const time = new Date(`1970-01-01T${part('hour')}:${part('minute')}:00Z`);
  await db.learning_preferences.create({ data: { user_id: ids.user, reminders_enabled: true, reminder_time: time } });
  await db.study_schedule_slots.create({ data: { user_id: ids.user, weekday, start_time: time, enabled: true, duration_minutes: 60 } });
  const [slot] = await db.$queryRawUnsafe('SELECT * FROM notification_study_schedule_due(now()) WHERE user_id=$1::uuid', ids.user);
  assert.ok(slot, 'Saved calendar slot is due now');
  await repo.schedule({ userId: ids.user, type: 'STUDY_SESSION_REMINDER', category: 'learning', entityType: 'STUDY_SCHEDULE',
    entityId: `${ids.user}:${weekday}`, version: slot.version, dedupeKey: `study:${ids.user}:${slot.version}`,
    scheduledAt: slot.due_at, payload: { title: 'Đến giờ học theo lịch của bạn', message: 'Buổi học thử 60 phút theo lịch đã lưu.', actionUrl: '/profile?tab=personalization', actionLabel: 'Xem lịch học' } });
  await wait(1200);
  const calendarId = await deliver('STUDY_SESSION_REMINDER');
  const [calendarDelivery] = await db.$queryRawUnsafe('SELECT status,provider_message_id FROM email_deliveries WHERE reminder_id=$1::uuid', calendarId);
  assert.equal(calendarDelivery.status, 'SENT');
  assert.ok(calendarDelivery.provider_message_id);
  assert.equal(await notifications.countDocuments({ eventId: calendarId, type: 'STUDY_SESSION_REMINDER' }), 1);
  console.log('PASS saved weekly calendar -> current timezone slot -> in-app notification + email provider acceptance');
  await db.users.create({ data: { id: ids.uploader, email: 'ses-doc-uploader-fixture@codementor.test', display_name: 'Document uploader fixture', external_id: 'ses-doc-uploader-fixture' } });
  await db.group_members.create({ data: { id: ids.uploaderMember, group_id: ids.group, user_id: ids.uploader, role: 'deputy' } });
  await db.group_documents.create({ data: { id: ids.document, group_id: ids.group, title: 'Tài liệu ôn tập Stack', doc_type: 'Link', url: 'https://example.com/stack', uploader_id: ids.uploader } });
  await until(async () => (await rows('WORKSPACE_DOCUMENT_PENDING')).length === 1, 'pending document -> Kafka -> reviewer email queue');
  const pendingMail = (await rows('WORKSPACE_DOCUMENT_PENDING'))[0];
  assert.equal(await repo.workspaceDocumentEligible(pendingMail), true);
  await wait(1200);
  const pendingMailId = await deliver('WORKSPACE_DOCUMENT_PENDING');
  assert.equal((await rows('WORKSPACE_DOCUMENT_PENDING'))[0].status, 'SENT');
  await db.user_settings.update({ where: { user_id: ids.user }, data: { workspace_notifications: false } });
  await db.group_documents.update({ where: { id: ids.document }, data: { status: 'published', reviewed_by: ids.uploader } });
  await until(async () => (await rows('WORKSPACE_DOCUMENT_PUBLISHED')).length === 1, 'publication email still queues with in-app off');
  assert.equal(await repo.workspaceDocumentEligible(pendingMail), false, 'Pending reminder is invalid after approval');
  const publishedMail = (await rows('WORKSPACE_DOCUMENT_PUBLISHED'))[0];
  assert.equal(await repo.workspaceDocumentEligible(publishedMail), true);
  await wait(1200);
  const publishedMailId = await deliver('WORKSPACE_DOCUMENT_PUBLISHED');
  assert.equal((await rows('WORKSPACE_DOCUMENT_PUBLISHED'))[0].status, 'SENT');
  assert.equal(await notifications.countDocuments({ audienceKey: 'ses-reminder-fixture', type: 'WORKSPACE_DOCUMENT_PUBLISHED' }), 0);
  const documentDeliveries = await db.$queryRawUnsafe('SELECT status,provider_message_id FROM email_deliveries WHERE reminder_id=ANY($1::uuid[])', [pendingMailId, publishedMailId]);
  assert.equal(documentDeliveries.length, 2);
  assert.ok(documentDeliveries.every((item) => item.status === 'SENT' && item.provider_message_id));
  await db.group_documents.update({ where: { id: ids.document }, data: { deleted_at: new Date() } });
  assert.equal(await repo.workspaceDocumentEligible(publishedMail), false);
  console.log('PASS document upload -> reviewer email and approval -> member email; real SES acceptance; in-app opt-out independent; state/deletion rechecked');
  console.log(
    'Email reminder integration passed; SES transport:',
    process.argv.includes('--ses') ? 'real mailbox simulator' : 'recording provider',
  );
} catch(error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode=1;
} finally {
  if (created) {
    await db.study_groups.delete({ where: { id: ids.group } });
    await db.exercises.delete({ where: { id: ids.exercise } });
    await db.users.delete({ where: { id: ids.user } });
    await db.users.deleteMany({ where: { id: ids.uploader, external_id: 'ses-doc-uploader-fixture' } });
    // Delete only this script's source-change events (including cleanup triggers).
    await db.$executeRawUnsafe(
      `DELETE FROM processed_events WHERE event_id IN (
     SELECT id FROM outbox WHERE topic='evt.reminder.source-changed.v1' AND payload->'payload'->>'entityId'=ANY($1::text[]))`,
      fixtureIds,
    );
    await db.$executeRawUnsafe(
      `DELETE FROM outbox WHERE topic='evt.reminder.source-changed.v1' AND payload->'payload'->>'entityId'=ANY($1::text[])`,
      fixtureIds,
    );
    await mongo
      .db(process.env.MONGO_DB || 'codementor')
      .collection('notifications')
      .deleteMany({ audienceKey: { $in: ['ses-reminder-fixture', 'ses-doc-uploader-fixture'] } });
    console.log('Removed isolated reminder fixtures; existing demo users/workspaces preserved.');
  }
  await app?.close();
  await db.$disconnect();
  await mongo.close();
}
