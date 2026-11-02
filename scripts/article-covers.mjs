// Ảnh bìa bài viết, cùng phong cách ảnh bìa khoá học: nền tối, logo, icon công nghệ, tiêu đề lớn,
// gạch cam, chip chủ đề — bên phải là một khung mã gợi đúng nội dung bài.
//
//   node scripts/article-covers.mjs render     # dựng PNG vào content/articles/covers/
//   node scripts/article-covers.mjs publish    # tải lên S3 rồi gán cover_image_url (ENV_FILE=... chọn .env)
//
// `render` cần Google Chrome (headless) và repo codementor-frontend nằm cạnh repo này (icon công nghệ
// từ `tech-stack-icons`, logo từ apps/client/public). Ảnh dựng ra không commit (đã có trên S3): `publish`
// chạy ngay sau `render` trên cùng máy.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, 'content/articles/covers');
const FRONTEND = process.env.FRONTEND_DIR ?? join(repoRoot, '../codementor-frontend');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Một dòng mỗi bài: icon trong tech-stack-icons, nhãn chủ đề, và vài dòng mã nói đúng điều bài bàn. */
const COVERS = {
  'viet-api-de-doi-y-ve-sau': { icon: 'openapi', topic: 'Backend', code: ['GET /v1/orders?cursor=eyJpZCI6NDJ9', '200 OK', '{ "items": [...],', '  "nextCursor": "eyJpZCI6NjJ9" }'] },
  'ba-thoi-quen-giup-code-review-nhe-nhang-hon': { icon: 'github', topic: 'Làm việc nhóm', code: ['$ git diff --stat main', ' src/cart.ts   | 42 ++++---', ' 1 file changed, 28 (+), 14 (-)', '# PR nhỏ, mô tả rõ, review nhanh'] },
  'clean-code-cho-nguoi-moi-di-lam': { icon: 'vscode', topic: 'Kỹ năng', code: ['function totalPrice(items) {', '  return items', '    .filter(isInStock)', '    .reduce(sumPrice, 0);', '}'] },
  'bay-meo-debug-nhanh-hon-voi-chrome-devtools': { icon: 'chrome', topic: 'Frontend', code: ['console.table(users);', 'debugger; // dừng đúng chỗ', '$0.dataset.state', 'copy(await res.json());'] },
  'toi-uu-truy-van-postgresql-cho-nguoi-moi': { icon: 'postgresql', topic: 'Cơ sở dữ liệu', code: ['EXPLAIN ANALYZE', 'SELECT * FROM orders', ' WHERE user_id = 42', '-- Index Scan · 0.08 ms'] },
  'hieu-ve-index-trong-postgresql': { icon: 'postgresql', topic: 'Cơ sở dữ liệu', code: ['CREATE INDEX idx_orders_user', '  ON orders (user_id, created_at);', '-- Seq Scan  → Index Scan', '-- 1.2 s     → 3 ms'] },
  '5-ky-thuat-giup-ban-hoc-spring-boot-hieu-qua-hon': { icon: 'spring', topic: 'Backend', code: ['@RestController', 'class OrderController {', '  @GetMapping("/orders/{id}")', '  Order get(@PathVariable long id)', '}'] },
  'thiet-ke-bang-truoc-khi-viet-query-dau-tien': { icon: 'postgresql', topic: 'Cơ sở dữ liệu', code: ['CREATE TABLE orders (', '  id bigint PRIMARY KEY,', '  user_id bigint REFERENCES users,', '  total numeric(12,0) NOT NULL', ');'] },
  'devops-doc-log-truoc-khi-them-dashboard': { icon: 'grafana', topic: 'DevOps', code: ['{"level":"error",', ' "traceId":"7f3a9c",', ' "route":"POST /checkout",', ' "ms":2304}'] },
  'javascript-bat-day-async-await-cho-dung': { icon: 'js', topic: 'JavaScript', code: ['try {', '  await saveOrder(order);', '} catch (error) {', '  report(error); throw error;', '}'] },
  'react-re-render-hieu-dung-truoc-khi-toi-uu': { icon: 'react', topic: 'React', code: ['// 1. Đo bằng Profiler', '// 2. Đẩy state xuống gần nơi dùng', '// 3. memo sau cùng:', 'const Row = memo(RowView);'] },
  'khi-nao-can-state-management-o-frontend': { icon: 'redux', topic: 'Frontend', code: ['const [cart, setCart] =', '  useState([]);', '// chỉ khi nhiều nơi cùng đọc', '// mới cần store chung'] },
  'bo-cuc-css-chon-flex-hay-grid': { icon: 'css3', topic: 'CSS', code: ['.toolbar { display: flex; }', '.gallery {', '  display: grid;', '  grid-template-columns:', '    repeat(3, 1fr);', '}'] },
  'jira-cho-tester-moi-vong-doi-mot-bug': { icon: 'jira', topic: 'Kiểm thử', code: ['BUG-142  Nút thanh toán bị mờ', 'Open → In Progress', '     → In Review → Done', 'Priority: High · Sprint 12'] },
  'websocket-va-socket-io-khi-nao-nen-dung': { icon: 'socketio', topic: 'Realtime', code: ['io.on("connection", (socket) => {', '  socket.on("message", (msg) =>', '    io.emit("message", msg));', '});'] },
  'tailwind-css-dung-nhu-mot-design-system': { icon: 'tailwindcss', topic: 'CSS', code: ['<button class="rounded-md', '  bg-primary px-4 py-2', '  text-sm font-semibold">', '  Lưu thay đổi', '</button>'] },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function techIcon(name) {
  const pnpm = join(FRONTEND, 'node_modules/.pnpm');
  const dir = readdirSync(pnpm).find((d) => d.startsWith('tech-stack-icons@'));
  const source = readFileSync(join(pnpm, dir, 'node_modules/tech-stack-icons/dist/index.js'), 'utf8');
  const match = source.match(new RegExp(`[{,]"?${name}"?:\\{svg:\\{light:'([^']+)'`));
  if (!match) throw new Error(`không có icon ${name} trong tech-stack-icons`);
  return match[1];
}

/** Rút gọn ở ranh giới từ, để chú thích dưới tiêu đề không bị cắt giữa chữ. */
function clip(text, max) {
  if (text.length <= max) return text;
  const sentence = text.split(/(?<=[.!?])\s/)[0];
  if (sentence.length <= max) return sentence;
  return `${text.slice(0, text.lastIndexOf(' ', max))}…`;
}

function html(article, spec, logo) {
  // Three-line titles leave room for a one-line summary only, above the chips.
  const long = article.title.length > 46;
  const code = spec.code
    .map((line, i) => `<div><span class="ln">${i + 1}</span>${esc(line)}</div>`)
    .join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=JetBrains+Mono:wght@500&display=block" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
body{width:1280px;height:720px;overflow:hidden;font-family:Inter,sans-serif;color:#fff;
 background:radial-gradient(circle at 82% 45%,rgba(234,88,12,.22),transparent 42%),linear-gradient(135deg,#0b1220 0%,#111827 45%,#18181b 100%)}
.brand{position:absolute;left:72px;top:56px;display:flex;align-items:center;gap:14px;font-size:26px;font-weight:700}
.brand img{width:44px;height:44px}
.left{position:absolute;left:72px;top:150px;width:640px}
.tile{width:104px;height:104px;border-radius:24px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 18px 40px rgba(0,0,0,.35)}
.tile svg{width:64px;height:64px}
h1{margin-top:30px;font-size:${long ? 46 : 58}px;line-height:1.12;font-weight:800;letter-spacing:-1.5px}
.bar{margin-top:26px;width:96px;height:7px;border-radius:4px;background:#ea580c}
.sub{margin-top:22px;font-size:24px;line-height:1.4;color:#d4d4d8}
.chips{position:absolute;left:72px;bottom:86px;display:flex;gap:12px}
.chip{padding:9px 18px;border-radius:999px;font-size:20px;font-weight:600;background:#27272a;color:#e4e4e7}
.chip.hot{background:#ea580c;color:#fff}
.foot{position:absolute;left:72px;bottom:40px;font-size:16px;color:#a1a1aa}
.code{position:absolute;right:64px;top:190px;width:470px;border-radius:16px;background:#0d1117;border:1px solid #30363d;box-shadow:0 30px 70px rgba(0,0,0,.5);overflow:hidden}
.bar3{display:flex;gap:8px;padding:14px 16px;background:#161b22;border-bottom:1px solid #30363d}
.bar3 i{width:12px;height:12px;border-radius:50%;display:block}
.lines{padding:20px 22px;font-family:'JetBrains Mono',monospace;font-variant-ligatures:none;font-size:19px;line-height:1.75;color:#e6edf3;white-space:pre}
.ln{display:inline-block;width:30px;color:#6e7681}
</style></head><body>
<div class="brand"><img src="${logo}" alt="">Codementor</div>
<div class="left">
 <div class="tile">${techIcon(spec.icon)}</div>
 <h1>${esc(article.title)}</h1>
 <div class="bar"></div>
 <p class="sub">${esc(clip(article.excerpt, long ? 75 : 110))}</p>
</div>
<div class="code"><div class="bar3"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i></div><div class="lines">${code}</div></div>
<div class="chips"><span class="chip hot">${esc(spec.topic)}</span><span class="chip">${article.readMinutes} phút đọc</span><span class="chip">Bài viết</span></div>
<div class="foot">Bài viết do Codementor biên soạn</div>
</body></html>`;
}

async function articles() {
  const response = await fetch(`${process.env.PUBLIC_API ?? 'https://api.nguyennguyen0.id.vn/api/v1'}/articles?limit=100`);
  return (await response.json()).data.items;
}

async function render() {
  mkdirSync(OUT, { recursive: true });
  const logo = `data:image/png;base64,${readFileSync(join(FRONTEND, 'apps/client/public/brand-mark-dark.png')).toString('base64')}`;
  for (const article of await articles()) {
    const spec = COVERS[article.slug];
    if (!spec) {
      console.warn(`  BỎ QUA ${article.slug} — chưa có cấu hình ảnh bìa`);
      continue;
    }
    const page = join(OUT, `${article.slug}.html`);
    writeFileSync(page, html(article, spec, logo));
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=1280,720', '--virtual-time-budget=4000', `--screenshot=${join(OUT, `${article.slug}.png`)}`, `file://${page}`],
    { stdio: 'ignore' });
    execFileSync('rm', [page]);
    console.log(`  ${article.slug}.png`);
  }
}

/** `.env` đọc tay như các script seed khác; ENV_FILE trỏ tới file của môi trường đích. */
function env(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) values[m[1]] = m[2].trim();
  }
  return values;
}

async function publish() {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { PrismaClient } = await import('@prisma/client');
  const cfg = env(process.env.ENV_FILE ?? join(repoRoot, '.env'));
  for (const key of ['AWS_S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL'])
    if (!cfg[key]) throw new Error(`thiếu ${key} trong ${process.env.ENV_FILE ?? '.env'}`);
  const s3 = new S3Client({ region: cfg.AWS_REGION, credentials: { accessKeyId: cfg.AWS_ACCESS_KEY_ID, secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY } });
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? cfg.DATABASE_URL } } });
  const prefix = (cfg.AWS_S3_IMAGE_PREFIX ?? 'public/images').replace(/^\/+|\/+$/g, '');
  const publicBase = (cfg.AWS_S3_PUBLIC_URL ?? `https://${cfg.AWS_S3_BUCKET}.s3.${cfg.AWS_REGION}.amazonaws.com`).replace(/\/+$/, '');
  try {
    for (const slug of Object.keys(COVERS)) {
      const file = join(OUT, `${slug}.png`);
      if (!existsSync(file)) continue;
      const [row] = await db.$queryRawUnsafe('SELECT id FROM articles WHERE slug = $1', slug);
      if (!row) {
        console.warn(`  BỎ QUA ${slug} — không có bài viết`);
        continue;
      }
      const body = readFileSync(file);
      // Khoá theo nội dung: dựng lại ảnh là URL mới, CDN không giữ ảnh cũ.
      const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
      const key = `${prefix}/articles/${row.id}/cover/${slug}-${hash}.png`;
      await s3.send(new PutObjectCommand({ Bucket: cfg.AWS_S3_BUCKET, Key: key, Body: body, ContentType: 'image/png', CacheControl: 'public, max-age=31536000, immutable' }));
      await db.$executeRawUnsafe('UPDATE articles SET cover_image_url = $1, updated_at = now() WHERE id = $2::uuid', `${publicBase}/${key}`, row.id);
      console.log(`  ${slug} → ${publicBase}/${key}`);
    }
  } finally {
    await db.$disconnect();
  }
}

const command = process.argv[2];
if (command === 'render') await render();
else if (command === 'publish') await publish();
else console.log('dùng: node scripts/article-covers.mjs render|publish');
