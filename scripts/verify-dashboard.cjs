const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const base = 'http://localhost:3000';
async function login(username) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ username, password: process.env.WORKSPACE_DEMO_PASSWORD }) });
  assert.equal(response.status, 200, `Login ${username}`);
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}
async function get(cookie, route) {
  const response = await fetch(`${base}/api/backend${route}`, { headers: { cookie } });
  assert.equal(response.status, 200, `${route}: ${await response.clone().text()}`);
  return (await response.json()).data;
}
(async () => {
  assert(process.env.WORKSPACE_DEMO_PASSWORD, 'Set WORKSPACE_DEMO_PASSWORD');
  for (const email of ['workspace.owner.e2e@codementor.test', 'workspace.member.e2e@codementor.test']) {
    const cookie = await login(email);
    const me = await get(cookie, '/me');
    const learning = await get(cookie, '/activity/me/dashboard');
    const time = await db.lesson_progress.aggregate({ where: { user_id: me.id }, _sum: { time_spent_seconds: true } });
    assert.equal(learning.totalStudySeconds, time._sum.time_spent_seconds ?? 0);
    assert(learning.courses.every((item) => item.userId === me.id));
    const pending = await get(cookie, '/workspaces/me/pending-assignments');
    assert(pending.length <= 8);
    for (const item of pending) {
      const assignment = await db.assignments.findUnique({ where: { id: item.id }, include: { group_members: true, group_exercises: true } });
      assert.equal(assignment.group_members.user_id, me.id);
      assert.equal(assignment.group_members.status, 'active');
      assert.notEqual(assignment.status, 'done');
      assert.equal(assignment.group_exercises.deleted_at, null);
      assert.equal(assignment.group_exercises.publication_status, 'published');
    }
    const forged = await get(cookie, '/activity/me/dashboard?userId=00000000-0000-4000-8000-000000000000');
    assert.deepEqual(forged.courses, learning.courses);
    console.log(email, { studySeconds: learning.totalStudySeconds, pending: pending.length, ownDataOnly: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
