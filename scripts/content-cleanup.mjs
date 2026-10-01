// Dọn nội dung test/rác trên DB dùng chung — Phase 0 của plan-content-dashboard.md.
//
//   node --env-file=.env scripts/content-cleanup.mjs                 # dry-run: in bảng + ghi plan JSON
//   node --env-file=.env scripts/content-cleanup.mjs --apply <plan>  # chạy đúng plan đã duyệt
//
// Luật (đã chốt với chủ dự án): mục chưa ai dùng → xoá hẳn; đã có ghi danh / bài nộp / đơn mua /
// gắn vào bài học hay nhóm → lưu trữ qua API kiểm duyệt (để còn dòng nhật ký kiểm toán).
// Khoá đang nằm trong lộ trình thì HOÃN cho tới khi có khoá thay thế.
//
// `--apply` chỉ đọc file plan, không tự tìm lại ứng viên: thứ được chạy là đúng thứ đã duyệt.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

const { PrismaClient } = createRequire(import.meta.url)('@prisma/client');
const prisma = new PrismaClient();

/** Ứng viên theo tiêu đề. `owner` khoanh lại khi tiêu đề trùng với nội dung thật. */
const CANDIDATES = {
  course: [
    'Khóa học của nguyên',
    'Welcome to Codementor',
    'Nhập môn Node.js',
    'CSS hiện đại: Flexbox và Grid',
  ],
  roadmap: ['Lộ trình nhiều giảng viên'],
  exercise: [
    'Two Sum', 'sum 2 num', 'sum 2 num (Bản sao)', 'Smoke sau merge', 'Bai Luu Thu',
    'Bài có chủ đề', 'Tổng hai số (đã sửa)', 'Đếm số chẵn trong mảng',
    'Min num', 'Tính chiều rộng thật của một hộp CSS',
    // KHÔNG có "Kiểm tra ngoặc hợp lệ bằng Stack (Bản sao)": đó là bài giao thật trong nhóm demo.
  ],
  article: ['12312321', 'Bài viết Test', 'Bài viết - Test 1', 'Backend abc'],
};

/**
 * Nhóm test (1 thành viên, không bài nộp). Bài code chỉ gắn vào các nhóm này không tính là "có
 * người dùng"; xoá bài là xoá luôn dòng `group_exercises` (CASCADE) của chính nhóm test đó.
 */
const TEST_GROUPS = ['nhom-ai-6b5a9', 'nhom-ai-a6475'];

const n = (value) => Number(value ?? 0);

async function courses() {
  const rows = await prisma.$queryRaw`
    SELECT c.id::text, c.title, c.status::text,
      (SELECT count(*) FROM course_enrollments x WHERE x.course_id = c.id) enrollments,
      (SELECT count(*) FROM course_reviews x WHERE x.course_id = c.id) reviews,
      (SELECT count(*) FROM commerce_orders x WHERE x.course_id = c.id) orders,
      (SELECT count(*) FROM course_access_grants x WHERE x.course_id = c.id) grants,
      (SELECT string_agg(r.title, ' · ') FROM roadmap_courses rc JOIN roadmaps r ON r.id = rc.roadmap_id
         WHERE rc.course_id = c.id AND r.title <> ALL(${CANDIDATES.roadmap})) roadmaps
    FROM courses c WHERE c.title = ANY(${CANDIDATES.course})`;
  return rows.map((r) => {
    const used = n(r.enrollments) + n(r.reviews) + n(r.orders) + n(r.grants);
    const action = r.roadmaps ? 'defer' : r.status === 'archived' ? 'skip' : used ? 'archive' : 'delete';
    return { kind: 'course', id: r.id, title: r.title, status: r.status, action,
      why: r.roadmaps ? `còn trong lộ trình: ${r.roadmaps}` : `ghi danh ${n(r.enrollments)}, đánh giá ${n(r.reviews)}, đơn ${n(r.orders)}, cấp quyền ${n(r.grants)}` };
  });
}

async function roadmaps() {
  const rows = await prisma.$queryRaw`
    SELECT r.id::text, r.title, r.status::text,
      (SELECT count(*) FROM roadmap_enrollments x WHERE x.roadmap_id = r.id) enrollments
    FROM roadmaps r WHERE r.title = ANY(${CANDIDATES.roadmap})`;
  return rows.map((r) => ({ kind: 'roadmap', id: r.id, title: r.title, status: r.status,
    action: n(r.enrollments) ? 'archive' : 'delete', why: `ghi danh ${n(r.enrollments)}` }));
}

async function exercises() {
  const rows = await prisma.$queryRaw`
    SELECT e.id::text, e.title, e.status::text,
      (SELECT count(*) FROM submissions x WHERE x.exercise_id = e.id) submissions,
      (SELECT count(*) FROM lessons x WHERE x.exercise_id = e.id) lessons,
      (SELECT count(*) FROM group_exercises x JOIN study_groups g ON g.id = x.group_id
         WHERE x.exercise_id = e.id AND g.slug <> ALL(${TEST_GROUPS})) groups,
      (SELECT count(*) FROM exercise_progress x WHERE x.exercise_id = e.id) progress
    FROM exercises e WHERE e.title = ANY(${CANDIDATES.exercise})`;
  return rows.map((r) => {
    // `group_exercises` là ON DELETE CASCADE: xoá bài là xoá luôn bài đã giao trong nhóm.
    const used = n(r.submissions) + n(r.lessons) + n(r.groups) + n(r.progress);
    return { kind: 'exercise', id: r.id, title: r.title, status: r.status,
      action: r.status === 'archived' ? 'skip' : used ? 'archive' : 'delete',
      why: `nộp ${n(r.submissions)}, bài học ${n(r.lessons)}, nhóm ${n(r.groups)}, tiến độ ${n(r.progress)}` };
  });
}

async function testGroups() {
  const rows = await prisma.$queryRaw`
    SELECT g.id::text, g.name || ' (' || g.slug || ')' AS title, g.status::text,
      (SELECT count(*) FROM group_members m WHERE m.group_id = g.id AND m.status = 'active') members
    FROM study_groups g WHERE g.slug = ANY(${TEST_GROUPS})`;
  return rows.map((r) => ({ kind: 'workspace', id: r.id, title: r.title, status: r.status,
    action: r.status === 'archived' ? 'skip' : 'archive', why: `nhóm test, ${n(r.members)} thành viên` }));
}

async function articles() {
  const rows = await prisma.$queryRaw`
    SELECT a.id::text, a.title, a.status::text FROM articles a WHERE a.title = ANY(${CANDIDATES.article})
    UNION ALL
    -- Bản trùng: cùng tiêu đề, giữ bản tạo sớm nhất.
    SELECT a.id::text, a.title, a.status::text FROM articles a
    WHERE a.id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY title ORDER BY created_at) rn
                                   FROM articles) d WHERE rn > 1)`;
  return rows.map((r) => ({ kind: 'article', id: r.id, title: r.title, status: r.status,
    action: 'delete', why: 'bài test / bản trùng' }));
}

/** Bản nháp bỏ dở: không tự quyết — chủ dự án chọn từng mục. */
async function drafts() {
  const rows = await prisma.$queryRaw`
    SELECT 'course' kind, c.id::text, c.title, u.display_name author, c.updated_at FROM courses c
      LEFT JOIN users u ON u.id = c.created_by WHERE c.status = 'draft'
    UNION ALL
    SELECT 'roadmap', r.id::text, r.title, u.display_name, r.updated_at FROM roadmaps r
      LEFT JOIN users u ON u.id = r.created_by WHERE r.status = 'draft'
    UNION ALL
    SELECT 'exercise', e.id::text, e.title, u.display_name, e.updated_at FROM exercises e
      LEFT JOIN users u ON u.id = e.author_id WHERE e.status = 'draft'
    ORDER BY 1, 5`;
  return rows.map((r) => ({ kind: r.kind, id: r.id, title: r.title, status: 'draft', action: 'review',
    why: `tác giả ${r.author ?? '—'}, sửa lần cuối ${r.updated_at.toISOString().slice(0, 10)}` }));
}

function print(items) {
  const width = Math.max(...items.map((i) => i.title.length));
  for (const i of items) {
    console.log(`${i.action.padEnd(7)} ${i.kind.padEnd(8)} ${i.status.padEnd(9)} ${i.title.padEnd(width)}  ${i.why}`);
  }
}

async function dryRun() {
  const items = [...(await courses()), ...(await roadmaps()), ...(await exercises()),
    ...(await testGroups()), ...(await articles())];
  const review = await drafts();
  print(items);
  console.log(`\n-- Bản nháp (${review.length}) — chọn giữ/xoá trong file plan --`);
  print(review);
  const file = `content-cleanup-plan.${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify({ items, drafts: review }, null, 2));
  const count = (a) => items.filter((i) => i.action === a).length;
  console.log(`\nxoá ${count('delete')} · lưu trữ ${count('archive')} · hoãn ${count('defer')} · bỏ qua ${count('skip')} · nháp chờ chọn ${review.length}`);
  console.log(`plan: ${file}  (đổi action của bản nháp thành "delete" để xoá; giữ "review" là để nguyên)`);
}

// --- apply ----------------------------------------------------------------

const API = process.env.CLEANUP_API ?? 'https://api.nguyennguyen0.id.vn/api/v1';
const PATHS = { course: 'courses', roadmap: 'roadmaps', exercise: 'exercises', article: 'articles' };
const MONGO_CONTENT = { exercise: ['exercise_contents', 'exerciseId'], article: ['article_contents', 'articleId'] };

async function adminToken() {
  const { KEYCLOAK_INTERNAL_URL: url, KEYCLOAK_REALM: realm, KEYCLOAK_BFF_CLIENT_ID: id,
    KEYCLOAK_BFF_CLIENT_SECRET: secret, CLEANUP_ADMIN_USER: user, CLEANUP_ADMIN_PASSWORD: password } = process.env;
  const body = new URLSearchParams({ grant_type: 'password', client_id: id, client_secret: secret, username: user, password });
  const response = await fetch(`${url}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', body });
  if (!response.ok) throw new Error(`không lấy được token admin: HTTP ${response.status}`);
  return (await response.json()).access_token;
}

async function archive(token, item) {
  const reason = 'Dọn nội dung test/demo (plan-content-dashboard P0)';
  // Nhóm học lưu trữ qua đường quản trị của workspace-service, không qua kiểm duyệt nội dung.
  const url = item.kind === 'workspace'
    ? `${API}/workspaces/manage/${item.id}/archive`
    : `${API}/${PATHS[item.kind]}/${item.id}/moderate`;
  const body = item.kind === 'workspace' ? { reason } : { decision: 'archive', reason };
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${item.kind} ${item.title}: HTTP ${response.status} ${await response.text()}`);
}

async function hardDelete(mongo, item) {
  const table = { course: 'courses', roadmap: 'roadmaps', exercise: 'exercises', article: 'articles' }[item.kind];
  // RESTRICT ở submissions/lessons/roadmap_courses là lưới an toàn: nếu từ lúc dry-run tới giờ có
  // người dùng mới, Postgres từ chối và mục đó không bị xoá.
  await prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = $1::uuid AND status::text = $2`, item.id, item.status);
  const content = MONGO_CONTENT[item.kind];
  if (content) await mongo.collection(content[0]).deleteMany({ [content[1]]: item.id });
}

async function apply(file) {
  const plan = JSON.parse(readFileSync(file, 'utf8'));
  const todo = [...plan.items, ...plan.drafts].filter((i) => i.action === 'archive' || i.action === 'delete');
  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  const db = mongo.db(process.env.MONGO_DB || 'codementor');
  const token = todo.some((i) => i.action === 'archive') ? await adminToken() : null;
  let done = 0;
  for (const item of todo) {
    try {
      if (item.action === 'archive') await archive(token, item);
      else await hardDelete(db, item);
      console.log(`ok     ${item.action.padEnd(7)} ${item.kind.padEnd(8)} ${item.title}`);
      done += 1;
    } catch (error) {
      // Lỗi Prisma để dòng đầu trống; lý do thật (vd. vi phạm RESTRICT) nằm ở `meta`.
      const reason = error.meta?.message ?? error.message.trim().split('\n').at(-1);
      console.log(`LỖI   ${item.action.padEnd(7)} ${item.kind.padEnd(8)} ${item.title}: ${reason}`);
    }
  }
  console.log(`\n${done}/${todo.length} mục đã xử lý`);
  await mongo.close();
}

try {
  const at = process.argv.indexOf('--apply');
  if (at > 0) await apply(process.argv[at + 1]);
  else await dryRun();
} finally {
  await prisma.$disconnect();
}
