// Chuyển hội thoại AI Tutor cũ (`ai_conversations`) sang `ai_agent_sessions` (agentId "tutor").
//
//   node --env-file=.env scripts/migrate-tutor-conversations.mjs           # chỉ đếm, không ghi
//   node --env-file=.env scripts/migrate-tutor-conversations.mjs --apply   # ghi
//
// Chạy SAU `npm run migrate:ai`: validator mới của `ai_agent_sessions` mới có "tutor" trong enum.
//
// Idempotent: khoá đích suy từ hội thoại nguồn (`tutor:<workspaceId>:<conversationId>`) và chỉ
// ghi khi đích chưa có (`$setOnInsert`), nên chạy lại không nhân đôi, cũng không đè lên một hội
// thoại người dùng đã hỏi tiếp sau khi migrate. Không xoá `ai_conversations` — drop tay khi đã
// chắc chắn.
//
// Hình dạng đích khớp `app/tutor` của ai-service:
// - `messages`: tin nhắn AG-UI. Mỗi turn cũ thành một cặp user/assistant; id user GIỮ NGUYÊN id
//   turn cũ, vì `grounding` khoá theo id tin nhắn người dùng.
// - `grounding[userMessageId]`: đúng turn cũ (answer, supplementalAnswer, insufficientEvidence,
//   citations, createdAt) — đây là thứ trình duyệt vẽ thành hai khối.
// - `documents`: tài liệu của hội thoại cũ, để mở lại đúng lựa chọn.
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
// Cùng con số với `sessions.py`: TITLE_CHARS và TTL_DAYS. Hạn tính từ HÔM NAY, không từ
// `updatedAt` cũ — nếu không, hội thoại cũ hơn 90 ngày sẽ bị TTL dọn ngay sau khi chuyển.
const TITLE_CHARS = 80;
const TTL_DAYS = 90;
const MAX_MESSAGES = 400;

/** Phần ai-service đưa lại cho model ở lượt sau — xem `answer.as_history`. */
function assistantText(turn) {
  return [turn.answer, turn.supplementalAnswer].filter(Boolean).join('\n\n');
}

export function toSession(row, now = new Date()) {
  const messages = [];
  const grounding = {};
  for (const turn of row.turns ?? []) {
    messages.push({ id: turn.id, role: 'user', content: turn.question });
    messages.push({ id: `${turn.id}:answer`, role: 'assistant', content: assistantText(turn) });
    grounding[turn.id] = {
      answer: turn.answer,
      supplementalAnswer: turn.supplementalAnswer ?? '',
      insufficientEvidence: turn.insufficientEvidence,
      citations: turn.citations ?? [],
      createdAt: turn.createdAt,
    };
  }
  const title = (row.turns?.[0]?.question ?? row.title ?? 'Hội thoại mới').split(/\s+/).join(' ');
  return {
    _id: `tutor:${row.workspaceId}:${row._id}`,
    userId: row.userId,
    agentId: 'tutor',
    workspaceId: row.workspaceId,
    threadId: row._id,
    title: title.slice(0, TITLE_CHARS) || 'Hội thoại mới',
    messages: messages.slice(-MAX_MESSAGES),
    grounding,
    documents: (row.sources ?? []).map((source) => ({ id: source.id, title: source.title })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DB || 'codementor');
    const source = db.collection('ai_conversations');
    const target = db.collection('ai_agent_sessions');
    const counts = { read: 0, empty: 0, existing: 0, written: 0 };
    // Hội thoại chưa có lượt nào là bản ghi "Hỏi đáp tài liệu" trống — không có gì để mở lại.
    for await (const row of source.find({})) {
      counts.read += 1;
      if (!row.turns?.length) {
        counts.empty += 1;
        continue;
      }
      const session = toSession(row);
      if (!APPLY) {
        if (await target.countDocuments({ _id: session._id }, { limit: 1 })) counts.existing += 1;
        else counts.written += 1;
        continue;
      }
      const { _id, createdAt, ...fields } = session;
      const result = await target.updateOne(
        { _id },
        { $setOnInsert: { ...fields, createdAt } },
        { upsert: true },
      );
      if (result.upsertedCount) counts.written += 1;
      else counts.existing += 1;
    }
    console.log(
      `${APPLY ? 'Đã ghi' : 'Dry-run (thêm --apply để ghi)'}: đọc ${counts.read}, bỏ qua ${counts.empty} hội thoại trống, ` +
        `${counts.existing} đã có ở đích, ${APPLY ? 'ghi' : 'sẽ ghi'} ${counts.written}.`,
    );
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
