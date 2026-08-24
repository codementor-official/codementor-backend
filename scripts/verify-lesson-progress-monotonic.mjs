/**
 * Kiểm chứng "tiến độ chỉ đi tới" trên CSDL THẬT, trong một transaction rồi ROLLBACK —
 * không để lại hàng nào. Chạy: npm run verify:progress-monotonic
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Đúng câu UPSERT trong prisma-enrollment.repository.ts.
const upsert = (tx, userId, lessonId, status, completed) => tx.$queryRawUnsafe(`
  INSERT INTO lesson_progress (user_id, lesson_id, status, time_spent_seconds,
                               last_position_seconds, started_at, completed_at)
  VALUES ($1::uuid, $2::uuid, $3::progress_status, 0, NULL, now(), $4::timestamptz)
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    status = CASE WHEN lesson_progress.status = 'completed'
                  THEN 'completed'::progress_status
                  ELSE EXCLUDED.status END,
    time_spent_seconds = lesson_progress.time_spent_seconds + EXCLUDED.time_spent_seconds,
    last_position_seconds = COALESCE(EXCLUDED.last_position_seconds,
                                     lesson_progress.last_position_seconds),
    started_at = COALESCE(lesson_progress.started_at, EXCLUDED.started_at),
    completed_at = CASE
      WHEN lesson_progress.status = 'completed' OR EXCLUDED.status = 'completed'
        THEN COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at, now())
      ELSE NULL END
  RETURNING status::text AS status, completed_at AS "completedAt"`,
  userId, lessonId, status, completed ? new Date() : null);

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (cần ${expected})`}`);
};

try {
  await prisma.$transaction(async (tx) => {
    // Một học viên đã ghi danh + một bài của khoá đó, để trigger chạy đúng như thật.
    const [row] = await tx.$queryRawUnsafe(`
      SELECT ce.user_id AS "userId", l.id AS "lessonId", ce.course_id AS "courseId"
      FROM course_enrollments ce
      JOIN lessons l ON l.course_id = ce.course_id
      LIMIT 1`);
    if (!row) throw new Error("không tìm được cặp ghi danh/bài học để thử");

    const before = await tx.$queryRawUnsafe(
      `SELECT status::text AS status FROM lesson_progress WHERE user_id=$1::uuid AND lesson_id=$2::uuid`,
      row.userId, row.lessonId);
    console.log(`bài thử: lesson=${row.lessonId} · trạng thái ban đầu=${before[0]?.status ?? "(chưa có)"}\n`);

    // 1) Đánh dấu hoàn thành.
    const [done] = await upsert(tx, row.userId, row.lessonId, "completed", true);
    check("đánh dấu hoàn thành → status", done.status, "completed");
    const completedAt = done.completedAt;
    check("hoàn thành thì có ngày hoàn thành", completedAt !== null, true);

    // 2) Ghi `in_progress` lên trên — đây là thứ từng phá dữ liệu.
    const [after] = await upsert(tx, row.userId, row.lessonId, "in_progress", false);
    check("ghi in_progress lên bài đã xong → status GIỮ NGUYÊN", after.status, "completed");
    check("… và ngày hoàn thành không bị xoá", after.completedAt?.getTime(), completedAt?.getTime());

    // 3) `not_started` cũng không hạ được.
    const [reset] = await upsert(tx, row.userId, row.lessonId, "not_started", false);
    check("ghi not_started lên bài đã xong → status GIỮ NGUYÊN", reset.status, "completed");

    // 4) Bài CHƯA xong thì vẫn ghi in_progress bình thường (không được chặn nhầm).
    const [other] = await tx.$queryRawUnsafe(`
      SELECT l.id FROM lessons l
      WHERE l.course_id=$1::uuid
        AND l.id NOT IN (SELECT lesson_id FROM lesson_progress WHERE user_id=$2::uuid)
      LIMIT 1`, row.courseId, row.userId);
    if (other) {
      const [fresh] = await upsert(tx, row.userId, other.id, "in_progress", false);
      check("bài chưa xong vẫn nhận in_progress", fresh.status, "in_progress");
    } else {
      console.log("SKIP  không còn bài chưa có tiến độ để thử nhánh in_progress");
    }

    throw new Error("__ROLLBACK__");
  });
} catch (cause) {
  if (cause.message !== "__ROLLBACK__") throw cause;
  console.log("\n(transaction đã rollback — CSDL không đổi)");
}

const leftovers = await prisma.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM lesson_progress WHERE started_at > now() - interval '2 minutes'`);
console.log(`hàng lesson_progress mới trong 2 phút qua: ${leftovers[0].n}`);
console.log(failures === 0 ? "\nTẤT CẢ ĐỀU QUA" : `\n${failures} PHÉP THỬ HỎNG`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
