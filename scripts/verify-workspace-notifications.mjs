// Run with notification-service + Kafka + Mongo running. Private isolated fixtures only.
// New users are unverified: no real email can be sent. Cleanup touches only these IDs.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { MongoClient } from 'mongodb';
if (process.env.NODE_ENV === 'production') throw new Error('Development/test only');
const db = new PrismaClient(), mongo = new MongoClient(process.env.MONGO_URI);
const id = (n) => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), member = id(2), deputy = id(3), group = id(4);
const users = [owner, member, deputy];
const subjects = ['workspace-notify-owner-fixture', 'workspace-notify-member-fixture', 'workspace-notify-deputy-fixture'];
let created = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await pause(300); }
  throw new Error('Timed out: ' + label);
}
try {
  await mongo.connect();
  const notifications = mongo.db(process.env.MONGO_DB || 'codementor').collection('notifications');
  await db.$transaction(async (tx) => {
    assert.equal(await tx.users.count({ where: { id: { in: users } } }), 0, 'Do not overwrite fixtures');
    for (const [i, uid] of users.entries()) await tx.users.create({ data: { id: uid, display_name: subjects[i], external_id: subjects[i], email: `${subjects[i]}@codementor.test` } });
    await tx.study_groups.create({ data: { id: group, owner_id: owner, name: 'Private notification integration fixture', slug: 'workspace-notify-fixture', invite_code: 'NOTIFYFIX1', privacy: 'private' } });
    for (const [i, uid] of users.entries()) await tx.group_members.create({ data: { id: id(10+i), group_id: group, user_id: uid, role: ['owner','member','deputy'][i] } });
    await tx.group_member_permissions.create({ data: { group_member_id: id(12), permission: 'approve_doc', allowed: false } });
  });
  created = true;
  const count = (type, subject) => notifications.countDocuments({ type, audienceKey: subject, referenceId: group });
  await db.group_documents.create({ data: { id: id(20), group_id: group, title: 'Stack review fixture', doc_type: 'Link', url: 'https://example.com/stack', uploader_id: member } });
  await until(async () => await count('WORKSPACE_DOCUMENT_PENDING', subjects[0]) === 1, 'pending document reaches owner through outbox/Kafka');
  assert.equal(await count('WORKSPACE_DOCUMENT_PENDING', subjects[1]), 0);
  assert.equal(await count('WORKSPACE_DOCUMENT_PENDING', subjects[2]), 0);
  await db.group_documents.update({ where: { id: id(20) }, data: { status: 'published', reviewed_by: owner, reviewed_at: new Date() } });
  await until(async () => await count('WORKSPACE_DOCUMENT_PUBLISHED', subjects[1]) === 1 && await count('WORKSPACE_DOCUMENT_PUBLISHED', subjects[2]) === 1, 'approved document reaches members');
  assert.equal(await count('WORKSPACE_DOCUMENT_PUBLISHED', subjects[0]), 0);
  console.log('PASS document pending -> eligible reviewer only; approval -> members; actor excluded; real Kafka/Mongo');
  await db.user_settings.create({ data: { user_id: member, workspace_notifications: false } });
  await db.group_documents.create({ data: { id: id(21), group_id: group, title: 'Queue notification opt-out fixture', doc_type: 'Link', url: 'https://example.com/queue', uploader_id: owner, reviewed_by: owner, status: 'published' } });
  await until(async () => await count('WORKSPACE_DOCUMENT_PUBLISHED', subjects[2]) === 2, 'opt-in member receives second document');
  assert.equal(await count('WORKSPACE_DOCUMENT_PUBLISHED', subjects[1]), 1);
  console.log('PASS saved Workspace notification opt-out enforced on consumer');
  await db.group_documents.update({ where: { id: id(20) }, data: { status: 'hidden' } });
  await db.group_documents.update({ where: { id: id(20) }, data: { status: 'published' } });
  await db.group_members.update({ where: { id: id(11) }, data: { status: 'removed' } });
  await until(async () => await count('WORKSPACE_MEMBER_LEFT', subjects[0]) === 1, 'membership change notification');
  assert.equal(await count('WORKSPACE_DOCUMENT_PUBLISHED', subjects[2]), 2);
  console.log('PASS membership removal notification and republish deduplication');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (created) {
    await db.study_groups.delete({ where: { id: group } });
    await db.users.deleteMany({ where: { id: { in: users } } });
    const ownEvents = await db.$queryRawUnsafe(`SELECT id FROM outbox WHERE
      payload->'payload'->>'groupId'=$1 OR payload->'payload'->>'audienceKey'=ANY($2::text[])
      OR payload->'payload'->>'entityId'=ANY($3::text[])`, group, subjects, [...users, id(10), id(11), id(12)]);
    const eventIds = ownEvents.map((event) => event.id);
    await db.$executeRawUnsafe('DELETE FROM processed_events WHERE event_id=ANY($1::uuid[])', eventIds);
    await db.$executeRawUnsafe('DELETE FROM outbox WHERE id=ANY($1::uuid[])', eventIds);
    await mongo.db(process.env.MONGO_DB || 'codementor').collection('notifications').deleteMany({ audienceKey: { $in: subjects } });
    console.log('Removed isolated notification fixtures; existing workspaces/users unchanged.');
  }
  await db.$disconnect(); await mongo.close();
}
