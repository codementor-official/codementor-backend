// Nội dung bài viết soạn bằng Markdown trong content/articles/<slug>.md → thân bài (MongoDB) và
// excerpt, takeaway, số phút đọc (Postgres) của bài cùng slug.
//
//   node scripts/article-content.mjs           # chạy thử: in số từ, số phút, không ghi gì
//   node scripts/article-content.mjs --apply   # ghi thật
//
// Thay seed-article-bodies.mjs (đã gỡ: nó ghi đè bằng bản ngắn cũ). Chỉ cập nhật bài đã có (theo slug), không tạo bài, không đổi trạng thái
// duyệt, không bắn sự kiện. Frontmatter: `excerpt:` và `takeaway:`, mỗi khoá một dòng.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { MongoClient, ObjectId } from 'mongodb';
import { markdownToHtml, proseWords, splitFrontmatter } from './content/markdown.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(repoRoot, 'content/articles');
const WORDS_PER_MINUTE = 200;
const apply = process.argv.includes('--apply');

function env(key) {
  const line = readFileSync(join(repoRoot, '.env'), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (line === null) throw new Error(`thiếu ${key} trong .env`);
  return line[1].trim();
}

function field(frontmatter, key) {
  const value = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  if (!value) throw new Error(`thiếu "${key}:" trong frontmatter`);
  return value;
}

const db = new PrismaClient();
const mongo = await MongoClient.connect(env('MONGO_URI'));
const contents = mongo.db(env('MONGO_DB')).collection('article_contents');
try {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()) {
    const slug = file.replace(/\.md$/, '');
    const [frontmatter, body] = splitFrontmatter(readFileSync(join(DIR, file), 'utf8'));
    const html = markdownToHtml(body);
    const words = proseWords(body);
    // Code is read slower than prose: about 20 lines a minute.
    const codeLines = [...body.matchAll(/```\w*\n([\s\S]*?)```/g)].reduce((n, m) => n + m[1].split('\n').length, 0);
    const minutes = Math.max(3, Math.round(words / WORDS_PER_MINUTE + codeLines / 20));
    const [row] = await db.$queryRawUnsafe('SELECT id, content_ref FROM articles WHERE slug = $1', slug);
    if (!row?.content_ref) {
      console.warn(`  BỎ QUA ${slug} — không có bài hoặc bài chưa có nội dung`);
      continue;
    }
    console.log(`  ${slug}: ${words} từ, ${minutes} phút, ${html.length} ký tự HTML`);
    if (!apply) continue;
    const id = ObjectId.isValid(row.content_ref) ? new ObjectId(row.content_ref) : row.content_ref;
    const result = await contents.updateOne({ _id: id }, { $set: { contentHtml: html, updatedAt: new Date() } });
    if (result.matchedCount !== 1) throw new Error(`${slug}: không thấy article_contents ${row.content_ref}`);
    await db.$executeRawUnsafe(
      'UPDATE articles SET excerpt = $2, takeaway = $3, read_minutes = $4, updated_at = now() WHERE id = $1::uuid',
      row.id, field(frontmatter, 'excerpt'), field(frontmatter, 'takeaway'), minutes,
    );
  }
  if (!apply) console.log('\nChạy thử — thêm --apply để ghi.');
} finally {
  await mongo.close();
  await db.$disconnect();
}
