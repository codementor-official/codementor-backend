import { Injectable } from '@nestjs/common';
import { NotAuthorized } from '@codementor/kernel';
import { PrismaService } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';

/** Một việc người học đã làm, đủ chữ để hiển thị mà không phải tra thêm bảng nào. */
export interface ActivityEntry {
  kind: 'roadmap_enrolled' | 'course_enrolled' | 'course_completed' | 'lesson_completed' | 'exercise_solved';
  title: string;
  detail: string | null;
  occurredAt: string;
}

/**
 * Dòng thời gian học tập của một tài khoản, cho drawer chi tiết bên quản trị.
 *
 * Dựng từ dữ liệu ĐÃ CÓ — ghi danh và tiến độ — chứ không thêm bảng sự kiện mới. Bốn
 * bảng đọc ở đây đều thuộc learning-service (xem docs/02-service-architecture.md §5).
 *
 * Không có bài nộp trong danh sách này: `submission-service` hiện vẫn là khung rỗng. Khi
 * nó chạy thật, phần đó phải lấy qua HTTP từ chính nó, không phải bằng một câu SELECT
 * thêm ở đây.
 */
@Injectable()
export class UserActivityUseCases {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(actor: AuthenticatedUser, userId: string, limit = 50): Promise<ActivityEntry[]> {
    // Chỉ quản trị viên xem được lịch sử của NGƯỜI KHÁC. Kiểm ở use case chứ không chỉ ở
    // guard: mọi lối gọi khác về sau cũng đi qua đây.
    if (actor.role !== 'admin') throw new NotAuthorized('xem hoạt động của tài khoản khác');

    const capped = Math.min(Math.max(limit, 1), 200);

    // UNION ALL rồi sắp một lần, thay vì bốn truy vấn rồi trộn trong JavaScript: giới hạn
    // số dòng phải áp lên KẾT QUẢ ĐÃ TRỘN. Lấy 50 dòng mỗi loại rồi mới trộn sẽ bỏ mất
    // hoạt động mới của loại đông dòng, đúng thứ đang cần xem.
    const rows = await this.prisma.$queryRaw<
      { kind: ActivityEntry['kind']; title: string; detail: string | null; occurredAt: Date }[]
    >`
      SELECT * FROM (
        SELECT 'roadmap_enrolled' AS kind, r.title AS title,
               'Bắt đầu lộ trình' AS detail, re.started_at AS "occurredAt"
        FROM roadmap_enrollments re JOIN roadmaps r ON r.id = re.roadmap_id
        WHERE re.user_id = ${userId}::uuid

        UNION ALL
        SELECT 'course_enrolled', c.title, 'Ghi danh khoá học', ce.started_at
        FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id
        WHERE ce.user_id = ${userId}::uuid

        UNION ALL
        SELECT 'course_completed', c.title, 'Hoàn thành khoá học', ce.completed_at
        FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id
        WHERE ce.user_id = ${userId}::uuid AND ce.completed_at IS NOT NULL

        UNION ALL
        SELECT 'lesson_completed', l.title, c.title, lp.completed_at
        FROM lesson_progress lp
        JOIN lessons l  ON l.id = lp.lesson_id
        JOIN chapters ch ON ch.id = l.chapter_id
        JOIN courses c  ON c.id = ch.course_id
        WHERE lp.user_id = ${userId}::uuid AND lp.completed_at IS NOT NULL

        UNION ALL
        SELECT 'exercise_solved', e.title,
               'Điểm cao nhất ' || coalesce(ep.best_score::text, '—'), ep.first_solved_at
        FROM exercise_progress ep JOIN exercises e ON e.id = ep.exercise_id
        WHERE ep.user_id = ${userId}::uuid AND ep.first_solved_at IS NOT NULL
      ) AS timeline
      WHERE "occurredAt" IS NOT NULL
      ORDER BY "occurredAt" DESC
      LIMIT ${capped}`;

    return rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
  }
}
