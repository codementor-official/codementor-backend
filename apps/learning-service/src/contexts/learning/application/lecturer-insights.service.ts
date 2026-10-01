import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';

const TIMEZONE = 'Asia/Ho_Chi_Minh';

export interface LecturerInsights {
  days: number;
  /** Ghi danh đang học (active/paused) và đã xong, trên khoá CỦA giảng viên, mọi thời điểm. */
  activeLearners: number;
  completedLearners: number;
  newEnrollments: number;
  /** `null` khi khoá của giảng viên chưa có đánh giá nào. */
  avgRating: number | null;
  reviews: number;
  /** Lượt nộp và lượt đạt trên bài code giảng viên là tác giả, trong cửa sổ. */
  submissions: number;
  acceptedSubmissions: number;
  /** Tổng phần giảng viên nhận từ đơn đã thanh toán trong cửa sổ (VND). */
  revenue: number;
  daily: { date: string; completions: number; enrollments: number }[];
  topCourses: { id: string; title: string; learners: number; completed: number; avgProgress: number }[];
}

/**
 * Số liệu dashboard giảng viên. Chỉ ĐỌC, và chỉ trên nội dung có `created_by` / `author_id`
 * là chính giảng viên — một admin mở trang giảng viên không được thấy số của cả nền tảng.
 *
 * `submissions` là bảng của submission-service: cùng một PostgreSQL, đọc chéo được, không ghi.
 */
@Injectable()
export class LecturerInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(lecturerId: string, days: number): Promise<LecturerInsights> {
    const since = await this.windowStart(days);
    const [[totals], daily, topCourses] = await Promise.all([
      this.prisma.$queryRaw<
        {
          active: number; completed: number; recent: number; rating: string | null; reviews: number;
          submissions: number; accepted: number; revenue: number;
        }[]
      >`
        WITH mine AS (SELECT id FROM courses WHERE created_by = ${lecturerId}::uuid)
        SELECT
          (SELECT count(*)::int FROM course_enrollments e JOIN mine ON mine.id = e.course_id
             WHERE e.status IN ('active', 'paused')) AS active,
          (SELECT count(*)::int FROM course_enrollments e JOIN mine ON mine.id = e.course_id
             WHERE e.status = 'completed') AS completed,
          (SELECT count(*)::int FROM course_enrollments e JOIN mine ON mine.id = e.course_id
             WHERE e.started_at >= ${since}) AS recent,
          (SELECT round(avg(r.rating), 2)::text FROM course_reviews r JOIN mine ON mine.id = r.course_id) AS rating,
          (SELECT count(*)::int FROM course_reviews r JOIN mine ON mine.id = r.course_id) AS reviews,
          (SELECT count(*)::int FROM submissions s JOIN exercises x ON x.id = s.exercise_id
             WHERE x.author_id = ${lecturerId}::uuid AND s.submitted_at >= ${since}) AS submissions,
          (SELECT count(*)::int FROM submissions s JOIN exercises x ON x.id = s.exercise_id
             WHERE x.author_id = ${lecturerId}::uuid AND s.submitted_at >= ${since}
               AND s.verdict = 'accepted') AS accepted,
          (SELECT coalesce(sum(o.instructor_amount), 0)::int FROM commerce_orders o
             WHERE o.instructor_id = ${lecturerId}::uuid AND o.status = 'paid' AND o.created_at >= ${since}) AS revenue`,
      this.prisma.$queryRaw<{ date: string; completions: number; enrollments: number }[]>`
        WITH mine AS (SELECT id FROM courses WHERE created_by = ${lecturerId}::uuid),
        days AS (
          SELECT generate_series(
            date_trunc('day', now() AT TIME ZONE ${TIMEZONE}) - make_interval(days => ${days - 1}::int),
            date_trunc('day', now() AT TIME ZONE ${TIMEZONE}),
            interval '1 day') AS day
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
          (SELECT count(*)::int FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
             JOIN mine ON mine.id = l.course_id
             WHERE date_trunc('day', lp.completed_at AT TIME ZONE ${TIMEZONE}) = d.day) AS completions,
          (SELECT count(*)::int FROM course_enrollments e JOIN mine ON mine.id = e.course_id
             WHERE date_trunc('day', e.started_at AT TIME ZONE ${TIMEZONE}) = d.day) AS enrollments
        FROM days d ORDER BY d.day`,
      this.prisma.$queryRaw<{ id: string; title: string; learners: number; completed: number; progress: string }[]>`
        SELECT c.id::text, c.title,
          count(e.id)::int AS learners,
          count(e.id) FILTER (WHERE e.status = 'completed')::int AS completed,
          coalesce(round(avg(e.progress_percent), 1), 0)::text AS progress
        FROM courses c LEFT JOIN course_enrollments e ON e.course_id = c.id AND e.status <> 'dropped'
        WHERE c.created_by = ${lecturerId}::uuid AND c.status = 'published'
        GROUP BY c.id ORDER BY count(e.id) DESC, c.title LIMIT 5`,
    ]);

    return {
      days,
      activeLearners: totals.active,
      completedLearners: totals.completed,
      newEnrollments: totals.recent,
      avgRating: totals.rating === null ? null : Number(totals.rating),
      reviews: totals.reviews,
      submissions: totals.submissions,
      acceptedSubmissions: totals.accepted,
      revenue: totals.revenue,
      daily,
      topCourses: topCourses.map(({ progress, ...row }) => ({ ...row, avgProgress: Number(progress) })),
    };
  }

  /** 00:00 giờ Việt Nam của (hôm nay − days + 1), cùng mốc với chuỗi `daily`. */
  private async windowStart(days: number): Promise<Date> {
    const [row] = await this.prisma.$queryRaw<{ since: Date }[]>`
      SELECT (date_trunc('day', now() AT TIME ZONE ${TIMEZONE})
              - make_interval(days => ${days - 1}::int)) AT TIME ZONE ${TIMEZONE} AS since`;
    return row.since;
  }
}
