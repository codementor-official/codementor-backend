// Đưa bộ tài liệu đánh giá Tutor vào nhóm "A+ Python" (`a-python-579cc`), hoặc gỡ ra.
//
//   (cd apps/ai-service && uv run python eval/tutor/build_documents.py)   # dựng build/ + manifest
//   node --env-file=.env scripts/seed-tutor-eval.mjs                      # tải lên S3 + group_documents
//   node --env-file=.env scripts/seed-tutor-eval.mjs --remove             # gỡ cả hai
//
// Cùng cách `seed-workspace-demo.mjs` dựng tài liệu nhóm: tệp thật trên S3 dưới nhánh
// `…/workspaces/<groupId>/`, hàng `group_documents` trạng thái `published` do chủ nhóm tải lên.
// Id cố định lấy từ manifest, nên chạy lại chỉ cập nhật chứ không nhân đôi, và bộ câu hỏi của
// `eval/tutor` luôn trỏ đúng tài liệu.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const SLUG = 'a-python-579cc';
const BUILD = join(import.meta.dirname, '..', 'apps', 'ai-service', 'eval', 'tutor', 'build');
const BUCKET = process.env.AWS_S3_BUCKET;
const PREFIX = (process.env.AWS_S3_DOCUMENT_PREFIX || 'public/workspace-documents').replace(
  /^\/+|\/+$/g,
  '',
);
const CONTENT_TYPES = {
  MD: 'text/markdown; charset=utf-8',
  TXT: 'text/plain; charset=utf-8',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

if (!BUCKET || !process.env.AWS_ACCESS_KEY_ID) throw new Error('Thiếu cấu hình AWS S3 (AWS_S3_BUCKET, AWS_ACCESS_KEY_ID)');
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-1',
  endpoint: process.env.AWS_S3_ENDPOINT || undefined,
  forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const prisma = new PrismaClient();

function objectUrl(key) {
  const base = process.env.AWS_S3_PUBLIC_URL;
  return base
    ? `${base.replace(/\/+$/, '')}/${key}`
    : `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-southeast-1'}.amazonaws.com/${key}`;
}

try {
  const group = await prisma.study_groups.findFirst({ where: { slug: SLUG } });
  if (!group) throw new Error(`Không thấy nhóm ${SLUG}`);
  const manifest = JSON.parse(readFileSync(join(BUILD, 'manifest.json'), 'utf8'));
  const keyOf = (item) => `${PREFIX}/workspaces/${group.id}/eval-tutor/${item.file}`;

  if (process.argv.includes('--remove')) {
    for (const item of manifest) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: keyOf(item) }));
    }
    const { count } = await prisma.group_documents.deleteMany({
      where: { id: { in: manifest.map((item) => item.id) } },
    });
    console.log(`Đã gỡ ${count} tài liệu đánh giá khỏi ${group.name}.`);
  } else {
    const now = new Date();
    const sources = [];
    for (const item of manifest) {
      const body = readFileSync(join(BUILD, item.file));
      const key = keyOf(item);
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: body,
          ContentType: CONTENT_TYPES[item.docType],
          Metadata: { workspace: group.id, fixture: `tutor-eval-${item.key}` },
        }),
      );
      const data = {
        group_id: group.id,
        title: item.title,
        doc_type: item.docType,
        topic: 'Python',
        uploader_id: group.owner_id,
        size_bytes: BigInt(body.length),
        storage_key: key,
        url: objectUrl(key),
        preview_text: null,
        status: 'published',
        ai_verdict: 'valid',
        reviewed_by: group.owner_id,
        reviewed_at: now,
        deleted_at: null,
      };
      const row = await prisma.group_documents.upsert({
        where: { id: item.id },
        // `uploaded_at` chỉ đặt lúc tạo: nó nằm trong revision của tài liệu, đổi nó là bắt AI
        // index lại toàn bộ dù tệp không đổi.
        create: { id: item.id, ...data, uploaded_at: now },
        update: data,
      });
      // Descriptor y hệt `WorkspaceAiService.descriptor` (workspace-service): bộ đánh giá index và
      // hỏi trên ĐÚNG revision mà giao diện thấy, nên không có lần index thứ hai khi mở trang.
      const source = {
        id: row.id,
        title: row.title,
        docType: row.doc_type.toLowerCase(),
        storageKey: row.storage_key,
        previewText: row.storage_key ? null : row.preview_text,
      };
      const revision = createHash('sha256')
        .update(JSON.stringify({ ...source, uploadedAt: row.uploaded_at.toISOString() }))
        .digest('hex');
      sources.push({ ...source, revision, key: item.key });
      console.log(`  ${item.docType.padEnd(4)} ${item.title}`);
    }
    writeFileSync(
      join(BUILD, 'sources.json'),
      JSON.stringify({ workspaceId: group.id, ownerId: group.owner_id, sources }, null, 2),
    );
    console.log(`Đã đưa ${manifest.length} tài liệu vào ${group.name} (${group.id}).`);
  }
} finally {
  await prisma.$disconnect();
}
