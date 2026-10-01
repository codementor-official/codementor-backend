// Đồng bộ nội dung trong `content/` lên CodeMentor qua ĐÚNG API của studio giảng viên —
// Phase 2 của plan-content-dashboard.md. Nội dung là file trong repo, duyệt bằng git diff.
//
//   node --env-file=.env scripts/content-sync.mjs check   [đường dẫn…]   # lint + chạy lời giải qua judge
//   node --env-file=.env scripts/content-sync.mjs push    [đường dẫn…]   # tạo/cập nhật + gửi duyệt
//   node --env-file=.env scripts/content-sync.mjs approve [đường dẫn…]   # admin duyệt bản đang chờ
//
// Đường dẫn là thư mục bài (`content/exercises/<slug>`) hoặc khoá (`content/courses/<slug>`);
// bỏ trống = toàn bộ `content/`. `push` đẩy bài code trước khoá học, vì khoá trỏ tới bài theo slug.
//
// Biến môi trường (ngoài .env backend): KEYCLOAK_INTERNAL_URL, KEYCLOAK_REALM,
// KEYCLOAK_BFF_CLIENT_ID, KEYCLOAK_BFF_CLIENT_SECRET (cùng bộ với apps/client/.env.local),
// CONTENT_AUTHOR_USER/PASSWORD (giảng viên đứng tên), CONTENT_ADMIN_USER/PASSWORD (cho approve),
// CONTENT_API (mặc định production).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { markdownToHtml, proseWords, splitFrontmatter } from './content/markdown.mjs';

const ROOT = resolve(import.meta.dirname, '../content');
const API = process.env.CONTENT_API ?? 'https://api.nguyennguyen0.id.vn/api/v1';

/** Ngưỡng chất lượng đã chốt trong plan. `error` chặn push, `warn` chỉ nhắc. */
const QUALITY = {
  lessonWords: { error: 600, warn: 800, max: 2000 },
  statementWords: 60,
  tests: 8,
  publicTests: 2,
  hiddenTests: 4,
  examples: 2,
  chapters: [3, 5],
  lessons: [10, 16],
};

const LANGUAGES = [
  { id: 'python', label: 'Python', monaco: 'python', file: 'solution.py' },
  { id: 'javascript', label: 'JavaScript', monaco: 'javascript', file: 'solution.js' },
  { id: 'cpp', label: 'C++', monaco: 'cpp', file: 'solution.cpp' },
];

const STARTERS = {
  python: 'import sys\n\n\ndef main():\n    data = sys.stdin.read().split()\n    # Viết lời giải ở đây\n\n\nmain()\n',
  javascript: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\n// Viết lời giải ở đây\n",
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Viết lời giải ở đây\n    return 0;\n}\n',
};

// --- đọc nội dung ----------------------------------------------------------

function readExercise(dir) {
  const meta = yaml.load(readFileSync(join(dir, 'exercise.yaml'), 'utf8'));
  const statement = readFileSync(join(dir, 'statement.md'), 'utf8').trim();
  const solutions = Object.fromEntries(
    LANGUAGES.filter((l) => existsSync(join(dir, l.file))).map((l) => [l.id, readFileSync(join(dir, l.file), 'utf8')]),
  );
  return { dir, slug: basename(dir), meta, statement, solutions };
}

function readCourse(dir) {
  const meta = yaml.load(readFileSync(join(dir, 'course.yaml'), 'utf8'));
  const chapters = meta.chapters.map((chapter) => ({
    ...chapter,
    lessons: chapter.lessons.map((entry) => {
      if (entry.exercise) return { kind: 'exercise', ...entry };
      const [front, body] = splitFrontmatter(readFileSync(join(dir, 'lessons', entry.md), 'utf8'));
      return { kind: 'article', file: entry.md, ...yaml.load(front), body: body.trim() };
    }),
  }));
  return { dir, slug: meta.slug ?? basename(dir), meta, chapters };
}

function units(paths) {
  const targets = paths.length
    ? paths.map((p) => resolve(p))
    : ['exercises', 'courses'].flatMap((kind) =>
        existsSync(join(ROOT, kind)) ? readdirSync(join(ROOT, kind)).map((name) => join(ROOT, kind, name)) : []);
  const exercises = targets.filter((p) => existsSync(join(p, 'exercise.yaml'))).map(readExercise);
  const courses = targets.filter((p) => existsSync(join(p, 'course.yaml'))).map(readCourse);
  return { exercises, courses };
}

// --- kiểm tra cục bộ -------------------------------------------------------

function lintExercise(ex, tags) {
  const errors = [];
  const { meta } = ex;
  for (const key of ['title', 'difficulty', 'summary', 'tags', 'tests', 'examples', 'hints']) {
    if (!meta[key]) errors.push(`thiếu "${key}"`);
  }
  if (proseWords(ex.statement) < QUALITY.statementWords) errors.push(`đề chỉ ${proseWords(ex.statement)} chữ (< ${QUALITY.statementWords})`);
  const tests = meta.tests ?? [];
  const visible = tests.filter((t) => t.visibility === 'public').length;
  if (tests.length < QUALITY.tests) errors.push(`${tests.length} test (< ${QUALITY.tests})`);
  if (visible < QUALITY.publicTests) errors.push(`${visible} test công khai (< ${QUALITY.publicTests})`);
  if (tests.length - visible < QUALITY.hiddenTests) errors.push(`${tests.length - visible} test ẩn (< ${QUALITY.hiddenTests})`);
  if ((meta.examples ?? []).length < QUALITY.examples) errors.push(`ít hơn ${QUALITY.examples} ví dụ`);
  for (const lang of LANGUAGES) if (!ex.solutions[lang.id]) errors.push(`thiếu ${lang.file}`);
  for (const tag of meta.tags ?? []) if (!tags.has(tag)) errors.push(`tag không tồn tại: ${tag}`);
  return errors;
}

function lintCourse(course, tags, exerciseSlugs) {
  const errors = [];
  const warnings = [];
  const { meta, chapters } = course;
  const lessons = chapters.flatMap((c) => c.lessons);
  const [minCh, maxCh] = QUALITY.chapters;
  const [minLe, maxLe] = QUALITY.lessons;
  if (chapters.length < minCh || chapters.length > maxCh) errors.push(`${chapters.length} chương (cần ${minCh}–${maxCh})`);
  if (lessons.length < minLe || lessons.length > maxLe) errors.push(`${lessons.length} bài (cần ${minLe}–${maxLe})`);
  for (const tag of meta.tags ?? []) if (!tags.has(tag)) errors.push(`tag không tồn tại: ${tag}`);
  for (const chapter of chapters) {
    if (!chapter.lessons.some((l) => l.kind === 'exercise')) errors.push(`chương "${chapter.title}" không có bài code`);
    for (const lesson of chapter.lessons) {
      if (lesson.kind === 'exercise') {
        if (!exerciseSlugs.has(lesson.exercise)) errors.push(`bài code "${lesson.exercise}" không có trong content/exercises`);
        continue;
      }
      const words = proseWords(lesson.body);
      const where = `${lesson.file} (${words} chữ)`;
      if (!lesson.title || !lesson.summary || !lesson.objectives?.length) errors.push(`${lesson.file}: thiếu title/summary/objectives`);
      if (words < QUALITY.lessonWords.error) errors.push(`${where} quá mỏng`);
      else if (words < QUALITY.lessonWords.warn) warnings.push(`${where} dưới ${QUALITY.lessonWords.warn}`);
      else if (words > QUALITY.lessonWords.max) warnings.push(`${where} quá dài, nên tách bài`);
      if ((lesson.body.match(/```\w+/g) ?? []).length < 2) errors.push(`${lesson.file}: cần ≥2 ví dụ code`);
      try {
        markdownToHtml(lesson.body);
      } catch (error) {
        errors.push(`${lesson.file}: ${error.message}`);
      }
    }
  }
  return { errors, warnings };
}

// --- HTTP ------------------------------------------------------------------

async function token(user, password) {
  const { KEYCLOAK_INTERNAL_URL: url, KEYCLOAK_REALM: realm, KEYCLOAK_BFF_CLIENT_ID: id,
    KEYCLOAK_BFF_CLIENT_SECRET: secret } = process.env;
  if (!user || !password) throw new Error('thiếu tài khoản (CONTENT_AUTHOR_* / CONTENT_ADMIN_*)');
  const body = new URLSearchParams({ grant_type: 'password', client_id: id, client_secret: secret, username: user, password });
  const response = await fetch(`${url}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', body });
  if (!response.ok) throw new Error(`đăng nhập ${user}: HTTP ${response.status}`);
  return (await response.json()).access_token;
}

function client(bearer) {
  return async function call(method, path, body) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${bearer}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text).data ?? JSON.parse(text)) : null;
  };
}

async function all(call, path) {
  const items = [];
  let cursor;
  do {
    const page = await call('GET', `${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${cursor}` : ''}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function tagIndex(call) {
  return new Map((await call('GET', '/tags')).map((t) => [t.slug, t.id]));
}

// --- judge -----------------------------------------------------------------

/** Chạy lời giải Python làm đáp án, rồi bắt JS và C++ phải ra đúng như vậy trên MỌI test. */
async function judgeExercise(call, ex) {
  const inputs = [...ex.meta.examples.map((e) => e.input), ...ex.meta.tests.map((t) => t.input)];
  const cases = inputs.map((input, index) => ({ order: index + 1, input, expected: '' }));
  const timeLimitMs = ex.meta.timeLimitMs ?? 2000;
  const reference = await call('POST', '/judge/run', { language: 'python', sourceCode: ex.solutions.python, timeLimitMs, testCases: cases });
  const crashed = reference.cases.filter((c) => !['accepted', 'wrong_answer'].includes(c.verdict));
  if (crashed.length) throw new Error(`lời giải Python lỗi ở test ${crashed.map((c) => `#${c.order} ${c.verdict}`).join(', ')}`);
  const outputs = reference.cases.map((c) => c.actual);
  const problems = [];
  ex.meta.examples.forEach((example, index) => {
    if (outputs[index].trim() !== String(example.output).trim()) {
      problems.push(`ví dụ ${index + 1}: đề ghi "${String(example.output).trim()}", lời giải ra "${outputs[index].trim()}"`);
    }
  });
  for (const lang of ['javascript', 'cpp']) {
    const run = await call('POST', '/judge/run', {
      language: lang, sourceCode: ex.solutions[lang], timeLimitMs,
      testCases: cases.map((c, i) => ({ ...c, expected: outputs[i] })),
    });
    if (run.verdict !== 'accepted') {
      const bad = run.cases.filter((c) => c.verdict !== 'accepted').map((c) => `#${c.order} ${c.verdict}`);
      problems.push(`${lang}: ${run.compileOutput ? `biên dịch lỗi ${run.compileOutput.slice(0, 200)}` : bad.join(', ')}`);
    }
  }
  if (problems.length) throw new Error(problems.join('; '));
  return outputs.slice(ex.meta.examples.length);
}

// --- push ------------------------------------------------------------------

function exerciseContent(ex, expected) {
  const { meta } = ex;
  return {
    statement: ex.statement,
    ioMode: 'stdin_stdout',
    constraints: meta.constraints ?? [],
    hints: meta.hints.map((text, i) => ({ order: i + 1, text })),
    examples: meta.examples.map((e) => ({ input: e.input, output: String(e.output), explanation: e.explanation })),
    testCases: meta.tests.map((t, i) => ({ order: i + 1, input: t.input, expected: expected[i], visibility: t.visibility ?? 'hidden', weight: 1 })),
    languages: LANGUAGES.map((l) => ({ id: l.id, label: l.label, monaco: l.monaco, starterCode: STARTERS[l.id], referenceSolution: ex.solutions[l.id] })),
    evaluation: { checker: meta.checker ?? 'trimmed', stopOnFirstFailure: false },
  };
}

async function pushExercise(call, ex, tags, mine) {
  const { meta } = ex;
  const expected = await judgeExercise(call, ex);
  let record = mine.find((e) => e.slug === ex.slug);
  if (record?.status === 'pending_review') await call('POST', `/exercises/${record.id}/withdraw`);
  if (!record) {
    record = await call('POST', '/exercises', { title: meta.title, kind: 'code', difficulty: meta.difficulty, summary: meta.summary, slug: ex.slug });
  }
  await call('PATCH', `/exercises/${record.id}`, {
    title: meta.title, summary: meta.summary, difficulty: meta.difficulty,
    xpReward: meta.xp ?? 20, estimatedMinutes: meta.minutes ?? 20, timeLimitMs: meta.timeLimitMs ?? 2000,
    tagIds: meta.tags.map((t) => tags.get(t)),
  });
  await call('PUT', `/exercises/${record.id}/content`, exerciseContent(ex, expected));
  await call('POST', `/exercises/${record.id}/submit`);
  return record.id;
}

async function pushCourse(call, course, tags, exerciseIds) {
  const { meta } = course;
  const mine = await all(call, '/courses/mine');
  let record = mine.find((c) => c.slug === course.slug);
  if (record?.status === 'pending_review') await call('POST', `/courses/${record.id}/withdraw`);
  if (!record) record = await call('POST', '/courses', { title: meta.title, level: meta.level, slug: course.slug });
  await call('PATCH', `/courses/${record.id}`, {
    title: meta.title, level: meta.level, description: meta.description,
    prerequisiteNote: meta.prerequisiteNote ?? null, tagIds: meta.tags.map((t) => tags.get(t)),
    ...(meta.coverImageUrl ? { coverImageUrl: meta.coverImageUrl } : {}),
  });

  // Giữ id bài học cũ khi trùng (chương, tên bài): xoá bài là xoá luôn tiến độ của học viên.
  const current = await call('GET', `/courses/${record.id}`);
  const oldIds = new Map(current.chapters.flatMap((ch) => ch.lessons.map((l) => [`${ch.title}\u0000${l.title}`, l.id])));
  const oldChapters = new Map(current.chapters.map((ch) => [ch.title, ch.id]));
  const lessonTitle = (l) => (l.kind === 'exercise' ? l.title ?? `Bài tập: ${exerciseIds.get(l.exercise).title}` : l.title);
  await call('PUT', `/courses/${record.id}/curriculum`, {
    chapters: course.chapters.map((ch) => ({
      ...(oldChapters.has(ch.title) ? { id: oldChapters.get(ch.title) } : {}),
      title: ch.title,
      description: ch.description ?? null,
      lessons: ch.lessons.map((l) => {
        const id = oldIds.get(`${ch.title}\u0000${lessonTitle(l)}`);
        return {
          ...(id ? { id } : {}),
          title: lessonTitle(l),
          type: l.kind === 'exercise' ? 'exercise' : 'article',
          durationMinutes: l.minutes ?? (l.kind === 'exercise' ? 20 : 15),
          isPreview: Boolean(l.preview),
          exerciseId: l.kind === 'exercise' ? exerciseIds.get(l.exercise).id : null,
        };
      }),
    })),
  });

  const saved = await call('GET', `/courses/${record.id}`);
  for (const [ci, chapter] of course.chapters.entries()) {
    for (const [li, lesson] of chapter.lessons.entries()) {
      if (lesson.kind !== 'article') continue;
      const target = saved.chapters[ci].lessons[li];
      await call('PUT', `/courses/${record.id}/lessons/${target.id}/content`, {
        summary: lesson.summary, objectives: lesson.objectives, contentHtml: markdownToHtml(lesson.body),
      });
    }
  }
  await call('POST', `/courses/${record.id}/submit`, { note: meta.submitNote ?? 'Cập nhật nội dung theo plan-content-dashboard' });
  return record.id;
}

// --- lệnh ------------------------------------------------------------------

async function main() {
  const [command = 'check', ...paths] = process.argv.slice(2);
  const { exercises, courses } = units(paths);
  const author = client(await token(process.env.CONTENT_AUTHOR_USER, process.env.CONTENT_AUTHOR_PASSWORD));
  const tags = await tagIndex(author);
  const knownExercises = new Set(existsSync(join(ROOT, 'exercises')) ? readdirSync(join(ROOT, 'exercises')) : []);
  let failed = false;
  const report = (ok, label, detail = '') => {
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'LỖI '} ${label}${detail ? `  — ${detail}` : ''}`);
  };

  if (command === 'check' || command === 'push') {
    for (const ex of exercises) {
      const errors = lintExercise(ex, tags);
      if (errors.length) report(false, `bài ${ex.slug}`, errors.join('; '));
      else if (command === 'check') {
        try {
          await judgeExercise(author, ex);
          report(true, `bài ${ex.slug}`, `${ex.meta.tests.length} test, 3 ngôn ngữ khớp nhau`);
        } catch (error) {
          report(false, `bài ${ex.slug}`, error.message);
        }
      }
    }
    for (const course of courses) {
      const { errors, warnings } = lintCourse(course, tags, knownExercises);
      const lessons = course.chapters.flatMap((c) => c.lessons);
      report(!errors.length, `khoá ${course.slug}`, [...errors, ...warnings.map((w) => `cảnh báo: ${w}`)].join('; ') || `${course.chapters.length} chương, ${lessons.length} bài`);
    }
    if (command === 'check' || failed) return failed;

    const ids = new Map();
    const mine = await all(author, '/exercises/mine');
    for (const ex of exercises) {
      try {
        ids.set(ex.slug, { id: await pushExercise(author, ex, tags, mine), title: ex.meta.title });
        report(true, `đẩy bài ${ex.slug}`, 'đã gửi duyệt');
      } catch (error) {
        report(false, `đẩy bài ${ex.slug}`, error.message);
      }
    }
    // Bài code đã có trên server mà lần này không đẩy lại vẫn tham chiếu được theo slug.
    for (const e of await all(author, '/exercises/mine')) if (!ids.has(e.slug)) ids.set(e.slug, { id: e.id, title: e.title });
    for (const course of courses) {
      try {
        await pushCourse(author, course, tags, ids);
        report(true, `đẩy khoá ${course.slug}`, 'đã gửi duyệt');
      } catch (error) {
        report(false, `đẩy khoá ${course.slug}`, error.message);
      }
    }
    return failed;
  }

  if (command === 'approve') {
    const admin = client(await token(process.env.CONTENT_ADMIN_USER, process.env.CONTENT_ADMIN_PASSWORD));
    const pending = async (kind) => new Map((await all(author, `/${kind}/mine`)).filter((x) => x.status === 'pending_review').map((x) => [x.slug, x.id]));
    for (const [kind, list] of [['exercises', exercises], ['courses', courses]]) {
      const waiting = await pending(kind);
      for (const unit of list) {
        const id = waiting.get(unit.slug);
        if (!id) { report(true, `${kind} ${unit.slug}`, 'không có bản chờ duyệt'); continue; }
        try {
          await admin('POST', `/${kind}/${id}/moderate`, { decision: 'approve' });
          report(true, `duyệt ${kind} ${unit.slug}`);
        } catch (error) {
          report(false, `duyệt ${kind} ${unit.slug}`, error.message);
        }
      }
    }
    return failed;
  }

  throw new Error(`lệnh không biết: ${command} (check | push | approve)`);
}

process.exitCode = (await main()) ? 1 : 0;
