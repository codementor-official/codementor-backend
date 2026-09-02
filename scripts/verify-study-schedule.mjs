// Deterministic SQL integration: everything, including outbox events, is rolled back.
// No emails, preference changes or fixtures survive this check.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { ReminderRepository } from '../dist/apps/notification-service/apps/notification-service/src/contexts/notification/infrastructure/reminder.repository.js';
if (process.env.NODE_ENV === 'production') throw new Error('Development/test only');
const db = new PrismaClient();
const uid = '93000000-0000-4000-8000-000000000001';
const rollback = new Error('ROLLBACK_FIXTURE');
try {
  await db.$transaction(async (tx) => {
    assert.equal(await tx.users.findUnique({ where: { id: uid } }), null, 'Never overwrite existing fixtures');
    await tx.users.create({ data: { id: uid, email: 'schedule-fixture@codementor.test', display_name: 'Study calendar fixture', external_id: 'schedule-fixture', timezone: 'Asia/Ho_Chi_Minh' } });
    await tx.learning_preferences.create({ data: { user_id: uid, reminders_enabled: true, reminder_time: new Date('1970-01-01T20:41:00Z') } });
    await tx.user_settings.create({ data: { user_id: uid, email_notifications: false, learning_reminders: false } });
    await tx.study_schedule_slots.create({ data: { user_id: uid, weekday: 'wed', enabled: true, start_time: new Date('1970-01-01T20:41:00Z'), duration_minutes: 60 } });
    const repo = new ReminderRepository(new Proxy(tx, { get(target, key) {
      if (key === '$transaction') return (fn) => fn(tx);
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } }));
    const due = (at) => tx.$queryRawUnsafe('SELECT * FROM notification_study_schedule_due($1::timestamptz) WHERE user_id=$2::uuid', new Date(at), uid);
    const rows = () => tx.$queryRawUnsafe("SELECT * FROM notification_reminders WHERE user_id=$1::uuid AND entity_type='STUDY_SCHEDULE'", uid);
    const slot = (time, weekday = 'wed') => tx.$executeRawUnsafe('UPDATE study_schedule_slots SET weekday=$2::weekday,start_time=$3::time WHERE user_id=$1::uuid', uid, weekday, time);
    assert.equal((await due('2026-09-02T13:40:59Z')).length, 0);
    assert.equal((await due('2026-09-02T13:41:00Z')).length, 1);
    assert.equal((await due('2026-09-02T13:45:59Z')).length, 1);
    assert.equal((await due('2026-09-02T13:46:00Z')).length, 0);
    assert.equal((await due('2026-09-03T13:41:00Z')).length, 0);
    console.log('PASS weekday, timezone, five-minute grace, no old backfill; email opt-out does not disable in-app calendar');
    await repo.syncStudySchedules(new Date('2026-09-02T13:42:00Z'));
    await repo.syncStudySchedules(new Date('2026-09-02T13:42:00Z'));
    let [r] = await rows();
    assert.equal((await rows()).length, 1);
    assert.equal(r.status, 'PENDING');
    assert.equal(await repo.studyScheduleValid(r, new Date('2026-09-02T13:42:00Z')), true);
    await slot('21:00');
    assert.equal(await repo.studyScheduleValid(r, new Date('2026-09-02T13:42:00Z')), false);
    await repo.syncStudySchedules(new Date('2026-09-02T13:42:00Z'));
    assert.equal((await rows())[0].status, 'CANCELLED');
    await repo.syncStudySchedules(new Date('2026-09-02T14:00:00Z'));
    [r] = await rows();
    assert.equal(r.status, 'PENDING');
    assert.equal((await rows()).length, 1);
    await tx.$executeRawUnsafe("UPDATE notification_reminders SET status='SENT' WHERE id=$1::uuid", r.id);
    await slot('21:03');
    await repo.syncStudySchedules(new Date('2026-09-02T14:03:00Z'));
    assert.equal((await rows())[0].status, 'SENT');
    assert.equal((await rows()).length, 1);
    console.log('PASS repeat polls deduplicate; changed schedule cancels old occurrence; sent day never resends');
    await tx.learning_preferences.update({ where: { user_id: uid }, data: { reminders_enabled: false } });
    assert.equal((await due('2026-09-02T14:03:00Z')).length, 0);
    await tx.learning_preferences.update({ where: { user_id: uid }, data: { reminders_enabled: true } });
    await slot('23:59');
    assert.equal((await due('2026-09-02T17:01:00Z')).length, 1);
    await tx.users.update({ where: { id: uid }, data: { timezone: 'America/New_York' } });
    await slot('02:30', 'sun');
    assert.equal((await due('2026-03-08T07:30:00Z')).length, 0, 'Nonexistent DST time is not shifted');
    await slot('01:30', 'sun');
    assert.equal((await due('2026-11-01T05:30:00Z')).length, 0);
    assert.equal((await due('2026-11-01T06:30:00Z')).length, 1);
    console.log('PASS disabled preference, midnight grace, DST missing/repeated local time');
    throw rollback;
  }, { timeout: 60000 });
} catch (error) {
  if (error !== rollback) { console.error(error.message); process.exitCode = 1; }
} finally { await db.$disconnect(); }
if (!process.exitCode) console.log('Study schedule integration passed; all test writes rolled back.');
