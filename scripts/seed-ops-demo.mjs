// Dữ liệu demo cho hai trang admin "Code judge" và "Vận hành AI": 30 ngày lượt nộp bài
// (`submissions`, Postgres) và lời gọi model (`ai_call_events`, Mongo), đứng tên 12 tài khoản
// demo không có Keycloak (không đăng nhập được).
//
//   node --env-file=.env scripts/seed-ops-demo.mjs            # chạy thử: chỉ in ra sẽ ghi gì
//   node --env-file=.env scripts/seed-ops-demo.mjs --apply    # ghi
//   node --env-file=.env scripts/seed-ops-demo.mjs --purge    # xoá sạch mọi thứ script này ghi
//
// Ghi thẳng DB nên KHÔNG có sự kiện Kafka: không cộng XP, không thông báo, không đổi bộ đếm
// `exercises.attempt_count/solver_count`. Lượt nộp là bài luyện tập tự do (`assignment_id` NULL),
// nên trigger nhắc học trên `submissions` bỏ qua chúng.
//
// Dấu nhận biết để xoá: users `demo.learnerNN@codementor.cloud`, `submissions.note = SEED`,
// `ai_call_events.seed = SEED`. Mongo cũng tự xoá sự kiện AI sau 90 ngày (TTL sẵn có).
// `memory_kb` để NULL: judge thật chưa đo bộ nhớ, không bịa số cho nó.
// Tài khoản demo có `user_settings` tắt mọi email: không có dòng cài đặt thì
// `notification_recipient_context` coi là bật, và thông báo hệ thống gửi "tất cả" sẽ gửi tới họ.
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

const { PrismaClient, Prisma } = createRequire(import.meta.url)('@prisma/client');

const SEED = 'seed:ops-demo';
const DAYS = 30;
const TZ_OFFSET_H = 7; // Asia/Ho_Chi_Minh, không có giờ mùa hè

const LEARNERS = [
  'Nguyễn Minh Anh', 'Trần Quốc Bảo', 'Lê Thu Hà', 'Phạm Đức Huy', 'Hoàng Gia Linh', 'Vũ Thành Nam',
  'Đặng Ngọc Mai', 'Bùi Hoàng Phúc', 'Đỗ Khánh Vy', 'Ngô Tuấn Kiệt', 'Dương Bảo Ngọc', 'Lý Hải Đăng',
].map((name, i) => {
  const n = String(i + 1).padStart(2, '0');
  // Mức độ chăm: vài người nộp nhiều, đa số vừa phải — phân bố thật của một lớp học.
  return { name, email: `demo.learner${n}@codementor.cloud`, handle: `demo-learner-${n}`, weight: [6, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1][i] };
});

// --- ngẫu nhiên có hạt giống: chạy thử và ghi thật ra cùng một bộ số ---------------
let state = 0x5eed2026;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (items, weightOf = () => 1) => {
  let r = rand() * items.reduce((sum, item) => sum + weightOf(item), 0);
  for (const item of items) if ((r -= weightOf(item)) < 0) return item;
  return items[items.length - 1];
};
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
/** Log-normal quanh `median`: thời gian chạy và độ trễ có đuôi dài, không đối xứng. */
const lognormal = (median, spread) => {
  const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return Math.max(1, Math.round(median * Math.exp(spread * z)));
};
const poisson = (mean) => {
  let k = 0;
  for (let p = Math.exp(-mean), s = p, u = rand(); u > s; s += (p *= mean / ++k));
  return k;
};

// --- lịch: ngày theo giờ Việt Nam, cũ nhất trước --------------------------------
function days(now) {
  const local = new Date(now.getTime() + TZ_OFFSET_H * 3600_000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return Array.from({ length: DAYS }, (_, i) => {
    const start = today - (DAYS - 1 - i) * 86_400_000 - TZ_OFFSET_H * 3600_000; // 00:00 VN, tính ra UTC
    const weekday = new Date(today - (DAYS - 1 - i) * 86_400_000).getUTCDay();
    return { index: i, start, weekend: weekday === 0 || weekday === 6 };
  });
}

/** Giờ trong ngày nghiêng về buổi tối (19–23h) và giờ nghỉ trưa, như người đi học/đi làm. */
function at(day, now) {
  const hour = pick([...Array(24).keys()], (h) => (h < 6 ? 0.2 : h < 12 ? 1 : h < 14 ? 1.6 : h < 19 ? 1.1 : 2.6));
  const t = day.start + hour * 3600_000 + int(0, 3599) * 1000;
  return t > now.getTime() ? null : new Date(t);
}

/** Lượng hoạt động tăng dần trong 30 ngày, cuối tuần thưa hơn. */
const volume = (day, from, to) => (from + ((to - from) * day.index) / (DAYS - 1)) * (day.weekend ? 0.6 : 1);

// --- judge -------------------------------------------------------------------------
const RUNTIME = { python: 1750, javascript: 1500, cpp: 1300, java: 1900, c: 1250, go: 1400, typescript: 1650, php: 1700 };
const SOURCE = (language) => `${language === 'python' ? '#' : '//'} ${SEED}: lượt nộp demo, không phải code thật\n`;

function submissions(users, exercises, calendar, now) {
  const rows = [];
  const attempts = new Map();
  for (const day of calendar) {
    for (let s = poisson(volume(day, 6, 22)); s > 0; s--) {
      // Một "phiên" = một người ngồi vào một bài: thử tới khi AC hoặc bỏ cuộc.
      const user = pick(users, (u) => u.weight);
      const exercise = pick(exercises, (e) => (e.difficulty === 'easy' ? 3 : e.difficulty === 'medium' ? 2 : 1));
      const language = pick(exercise.languages, (l) => ({ python: 5, javascript: 3, cpp: 2 })[l] ?? 0.5);
      const hard = exercise.difficulty === 'hard' ? 0.15 : exercise.difficulty === 'medium' ? 0.08 : 0;
      let time = at(day, now);
      for (let tries = int(1, 4); tries > 0 && time; tries--) {
        const key = `${user.id}:${exercise.id}`;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        const pAccept = Math.min(0.9, 0.5 + 0.12 * (attempt - 1) - hard);
        const verdict = rand() < pAccept ? 'accepted'
          : pick(['wrong_answer', 'timeout', 'runtime_error', 'compile_error'], (v) => ({ wrong_answer: 6, timeout: 1.5, runtime_error: 1.5, compile_error: language === 'python' || language === 'javascript' ? 0.3 : 1.2 })[v]);
        const total = exercise.tests;
        const passed = verdict === 'accepted' ? total : verdict === 'compile_error' ? 0 : int(0, Math.max(0, total - 1));
        rows.push({
          userId: user.id, exerciseId: exercise.id, language, verdict, attempt, submittedAt: time,
          passed, total, score: total ? Math.floor((passed * 100) / total) : 0,
          runtimeMs: verdict === 'compile_error' ? null
            : verdict === 'timeout' ? exercise.timeLimitMs + lognormal(2500, 0.4)
            : lognormal(RUNTIME[language] ?? 1600, 0.25),
        });
        if (verdict === 'accepted') break;
        time = new Date(time.getTime() + int(2, 15) * 60_000);
        if (time > now) break;
      }
    }
  }
  return rows;
}

// --- AI ----------------------------------------------------------------------------
// Model, token và độ trễ lấy theo số đo thật trong `ai_call_events` (2026-10-02).
const AGENTS = {
  codey: { perDay: [10, 34], model: 'gpt-5-nano', input: 1400, output: 380, latency: 4200, who: 'learner' },
  rag: { perDay: [3, 10], model: 'gpt-5-nano', input: 2600, output: 420, latency: 3600, who: 'learner' },
  dashboard: { perDay: [2, 6], model: 'gpt-5-nano', input: 1200, output: 830, latency: 6300, who: 'learner' },
  lecter: { perDay: [2, 7], model: 'gpt-5.4-mini', input: 9000, output: 600, latency: 2700, who: 'lecturer' },
  lecter_workspace: { perDay: [1, 3], model: 'gpt-5.4-mini', input: 6000, output: 450, latency: 2900, who: 'learner' },
  suggest: { perDay: [1, 4], model: 'gpt-5-nano', input: 580, output: 630, latency: 5600, who: 'lecturer' },
  rag_index: { perDay: [0.5, 2], model: 'text-embedding-3-small', input: 7000, output: 0, latency: 900, who: 'lecturer' },
};
const PROVIDER_ERRORS = [
  ['RateLimitError', 'HTTP 429 · RateLimitError'],
  ['APITimeoutError', 'APITimeoutError'],
  ['InternalServerError', 'HTTP 500 · InternalServerError'],
];

function aiEvents(learners, lecturers, calendar, now) {
  const events = [];
  for (const day of calendar) {
    for (const [agent, spec] of Object.entries(AGENTS)) {
      for (let n = poisson(volume(day, ...spec.perDay)); n > 0; n--) {
        const time = at(day, now);
        if (!time) continue;
        const userId = (spec.who === 'learner' ? pick(learners, (u) => u.weight) : pick(lecturers)).id;
        const base = { at: time, agent, userId, seed: SEED };
        const roll = rand();
        if (roll < 0.015) {
          const [errorType, errorMessage] = pick(PROVIDER_ERRORS);
          events.push({ ...base, ok: false, model: spec.model, latencyMs: lognormal(spec.latency * 2, 0.5), errorType, errorMessage });
        } else if (agent === 'codey' && roll < 0.03) {
          // Chặn hạn mức ngày: không phải lời gọi model, nên không có model/token/độ trễ.
          events.push({ ...base, ok: false, model: null, latencyMs: 0, errorType: 'daily_limit', errorMessage: 'Đã hết lượt trong ngày' });
        } else {
          events.push({
            ...base, ok: true, model: spec.model,
            inputTokens: lognormal(spec.input, 0.45),
            outputTokens: spec.output ? lognormal(spec.output, 0.5) : 0,
            latencyMs: lognormal(spec.latency, 0.35),
          });
        }
      }
    }
  }
  return events;
}

// --- chạy --------------------------------------------------------------------------
async function main() {
  const mode = process.argv.includes('--purge') ? 'purge' : process.argv.includes('--apply') ? 'apply' : 'dry-run';
  const prisma = new PrismaClient();
  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  const events = mongo.db(process.env.MONGO_DB || 'codementor').collection('ai_call_events');
  const emails = LEARNERS.map((l) => l.email);

  try {
    if (mode === 'purge') {
      const ai = await events.deleteMany({ seed: SEED });
      const subs = await prisma.$executeRaw`DELETE FROM submissions WHERE note = ${SEED}`;
      const users = await prisma.$executeRaw`DELETE FROM users WHERE email = ANY(${emails}::citext[])`;
      console.log(`Đã xoá: ${ai.deletedCount} sự kiện AI, ${subs} lượt nộp, ${users} tài khoản demo.`);
      return;
    }

    const [[{ count: seeded }], [{ count: demoUsers }], seededAi] = await Promise.all([
      prisma.$queryRaw`SELECT count(*)::int AS count FROM submissions WHERE note = ${SEED}`,
      prisma.$queryRaw`SELECT count(*)::int AS count FROM users WHERE email = ANY(${emails}::citext[])`,
      events.countDocuments({ seed: SEED }),
    ]);
    if (seeded || demoUsers || seededAi) {
      console.log(`Đã có dữ liệu seed (${demoUsers} tài khoản, ${seeded} lượt nộp, ${seededAi} sự kiện AI). Chạy --purge trước.`);
      process.exitCode = 1;
      return;
    }

    const exerciseRows = await prisma.$queryRaw`
      SELECT id::text, difficulty::text, coalesce(time_limit_ms, 2000)::int AS "timeLimitMs"
      FROM exercises WHERE status = 'published' AND visibility = 'public' AND kind = 'code'`;
    const contents = await mongo.db(process.env.MONGO_DB || 'codementor').collection('exercise_contents')
      .find({ exerciseId: { $in: exerciseRows.map((e) => e.id) } }, { projection: { exerciseId: 1, 'languages.id': 1, testCases: 1 } })
      .toArray();
    const byId = new Map(contents.map((c) => [c.exerciseId, c]));
    const exercises = exerciseRows
      .map((e) => ({ ...e, languages: (byId.get(e.id)?.languages ?? []).map((l) => l.id), tests: byId.get(e.id)?.testCases?.length ?? 0 }))
      .filter((e) => e.languages.length && e.tests);
    const lecturers = await prisma.$queryRaw`SELECT id::text FROM users WHERE role = 'lecturer' AND status = 'active'`;

    // Id tạm cho chạy thử; khi ghi thật thì lấy id do Postgres cấp.
    const learners = LEARNERS.map((l, i) => ({ ...l, id: `dry-${i}`, createdAt: new Date(Date.now() - int(35, 70) * 86_400_000) }));
    const now = new Date();
    const calendar = days(now);
    const subs = submissions(learners, exercises, calendar, now);
    const ai = aiEvents(learners, lecturers, calendar, now);

    const verdicts = Object.entries(subs.reduce((acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }), {}));
    const agents = Object.entries(ai.reduce((acc, e) => ({ ...acc, [e.agent]: (acc[e.agent] ?? 0) + 1 }), {}));
    console.log(`${exercises.length} bài công khai, ${lecturers.length} giảng viên, ${learners.length} tài khoản demo`);
    console.log(`Lượt nộp: ${subs.length} — ${verdicts.map(([v, n]) => `${v} ${n}`).join(', ')}`);
    console.log(`Sự kiện AI: ${ai.length} — ${agents.map(([a, n]) => `${a} ${n}`).join(', ')}`);
    if (mode === 'dry-run') {
      console.log('Chạy thử, chưa ghi gì. Thêm --apply để ghi.');
      return;
    }

    // Postgres trong một transaction: lỗi giữa chừng thì không để lại user hay lượt nộp dở dang.
    const idOf = await prisma.$transaction(async (tx) => {
      for (const l of learners) {
        await tx.$executeRaw`
          INSERT INTO users (email, handle, display_name, role, status, email_verified_at, last_active_at, created_at, updated_at)
          VALUES (${l.email}, ${l.handle}, ${l.name}, 'learner', 'active', ${l.createdAt}, now(), ${l.createdAt}, now())`;
      }
      const rows = await tx.$queryRaw`SELECT id::text, email::text FROM users WHERE email = ANY(${emails}::citext[])`;
      const ids = new Map(rows.map((r) => [r.email, r.id]));
      for (const id of ids.values()) {
        await tx.$executeRaw`
          INSERT INTO user_settings (user_id, email_notifications, workspace_notifications, learning_reminders, weekly_digest)
          VALUES (${id}::uuid, false, false, false, false)`;
      }
      const idByDry = new Map(learners.map((l) => [l.id, ids.get(l.email)]));
      for (let i = 0; i < subs.length; i += 200) {
        const values = subs.slice(i, i + 200).map((s) => Prisma.sql`(
          ${idByDry.get(s.userId)}::uuid, ${s.exerciseId}::uuid, ${s.language}, ${SOURCE(s.language)}, ${s.verdict}::submission_verdict,
          ${s.score}, ${s.passed}, ${s.total}, ${s.runtimeMs}, ${s.attempt}, ${SEED}, ${s.submittedAt})`);
        await tx.$executeRaw`
          INSERT INTO submissions (user_id, exercise_id, language, source_code, verdict, score, passed_tests,
            total_tests, runtime_ms, attempt_number, note, submitted_at)
          VALUES ${Prisma.join(values)}`;
      }
      return idByDry;
    }, { timeout: 120_000 });
    await events.insertMany(ai.map((e) => ({ ...e, userId: idOf.get(e.userId) ?? e.userId })), { ordered: false });
    console.log('Đã ghi.');
  } finally {
    await prisma.$disconnect();
    await mongo.close();
  }
}

await main();
