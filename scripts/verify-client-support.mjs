import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const appUrl = (process.env.CLIENT_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const username = 'workspace.owner.e2e@codementor.test';
const memberUsername = 'workspace.member.e2e@codementor.test';
const password = process.env.WORKSPACE_DEMO_PASSWORD;
const adminUsername = process.env.ADMIN_DEMO_USERNAME || 'admin1@test.local';
const adminPassword = process.env.ADMIN_DEMO_PASSWORD;

async function loginAs(loginUsername, loginPassword = password) {
  const login = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST',
    headers: { origin: appUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ username: loginUsername, password: loginPassword }),
  });
  if (!login.ok) throw new Error(`Client login failed for ${loginUsername} (${login.status})`);
  return login.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .join('; ');
}

async function request(path, cookie, init = {}) {
  const method = init.method ?? 'GET';
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { origin: appUrl } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body?.data ?? body;
}

async function main() {
  if (!password) throw new Error('WORKSPACE_DEMO_PASSWORD is required for the live client check');
  const exercise = await prisma.exercises.findFirst({
    where: { status: 'published', visibility: 'public' },
    orderBy: { created_at: 'asc' },
    select: { id: true, slug: true },
  });
  if (!exercise) throw new Error('No public exercise is available for verification');

  const cookies = await loginAs(username);

  const leaderboard = await request('/api/backend/users/leaderboard?limit=5', cookies);
  if (!Array.isArray(leaderboard) || leaderboard.length === 0) {
    throw new Error('Explore leaderboard returned no learners');
  }
  const workspaces = await request('/api/backend/workspaces?scope=all&page=1&limit=10', cookies);
  if (!workspaces.items.some((item) => item.slug === 'workspace-demo-klt')) {
    throw new Error('Explore community did not return the public demo workspace');
  }

  await request('/api/backend/me/bookmarks', cookies, {
    method: 'POST',
    body: JSON.stringify({ targetType: 'EXERCISE', targetId: exercise.id }),
  });
  const bookmarks = await request(
    '/api/backend/me/bookmarks?type=EXERCISE&page=1&limit=10',
    cookies,
  );
  if (!bookmarks.items.some((item) => item.targetId === exercise.id)) {
    throw new Error('The saved exercise was not returned by the bookmark API');
  }
  await request(`/api/backend/me/bookmarks/EXERCISE/${exercise.id}`, cookies, { method: 'DELETE' });

  const report = await request('/api/backend/me/reports', cookies, {
    method: 'POST',
    body: JSON.stringify({
      targetType: 'EXERCISE',
      targetId: exercise.id,
      targetRef: exercise.slug,
      category: 'OTHER',
      note: 'E2E verification report',
    }),
  });
  if (report.status !== 'PENDING') throw new Error('The report was not stored as PENDING');
  const reports = await request('/api/backend/me/reports?page=1&limit=10', cookies);
  if (!reports.items.some((item) => item.id === report.id)) {
    throw new Error('The submitted report was not returned by the report API');
  }

  const memberCookies = await loginAs(memberUsername);
  const marker = `E2E global notification ${Date.now()}`;
  const message = await request('/api/backend/workspaces/workspace-demo-klt/messages', cookies, {
    method: 'POST',
    body: JSON.stringify({ content: marker }),
  });
  let notification = null;
  for (let attempt = 0; attempt < 10 && !notification; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const page = await request('/api/backend/notifications?limit=30', memberCookies);
    notification = page.items.find(
      (item) => item.type === 'WORKSPACE_MESSAGE' && item.metadata?.messageId === message.id,
    );
  }
  if (!notification) throw new Error('Workspace chat message did not reach the member notification bell');
  const ownerNotifications = await request('/api/backend/notifications?limit=30', cookies);
  if (ownerNotifications.items.some((item) => item.metadata?.messageId === message.id)) {
    throw new Error('The chat sender received their own workspace message notification');
  }

  let adminQueue = 'skipped (ADMIN_DEMO_PASSWORD is not set)';
  if (adminPassword) {
    const adminCookies = await loginAs(adminUsername, adminPassword);
    const queue = await request('/api/backend/reports?status=PENDING&page=1&limit=20', adminCookies);
    if (!queue.items.some((item) => item.id === report.id)) {
      throw new Error('The new report did not reach the admin moderation queue');
    }
    const resolved = await request(`/api/backend/reports/${report.id}`, adminCookies, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'RESOLVED',
        resolutionNote: 'Đã xác minh luồng xử lý report end-to-end.',
      }),
    });
    if (resolved.status !== 'RESOLVED') throw new Error('Admin could not resolve the report');
    adminQueue = 'list/resolve ok';
  }

  console.log(
    JSON.stringify(
      {
        login: 'ok',
        bookmarks: 'create/list/delete ok',
        report: 'submit/list PENDING ok',
        explore: `leaderboard ${leaderboard.length} rows, community workspace ok`,
        chatNotification: 'owner -> member bell ok; sender excluded',
        adminQueue,
        targetExercise: exercise.slug,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
