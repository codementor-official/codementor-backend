import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';

const TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Học dở mà không có hoạt động quá ngần này ngày thì tính là "ngưng học" (đã chốt 2026-11-06):
 * đủ dài để bỏ qua người nghỉ cuối tuần, đủ ngắn để giảng viên kịp nhắc.
 */
export const STALLED_DAYS = 14;

/**
 * Định nghĩa trạng thái học — MỘT chỗ duy nhất, admin và giảng viên dùng chung (ADR 0005).
 * Áp cho cả `course_enrollments` và `roadmap_enrollments` (cùng cột status/progress/activity).
 */
const STATUS_COUNTS = (e: string) => `
  count(${e}.id) FILTER (WHERE ${e}.status <> 'dropped')::int AS enrolled,
  count(${e}.id) FILTER (WHERE ${e}.status IN ('active','paused') AND ${e}.progress_percent = 0)::int AS "notStarted",
  count(${e}.id) FILTER (WHERE ${e}.status IN ('active','paused') AND ${e}.progress_percent > 0)::int AS "inProgress",
  count(${e}.id) FILTER (WHERE ${e}.status IN ('active','paused') AND ${e}.progress_percent > 0
    AND COALESCE(${e}.last_activity_at, ${e}.started_at) < now() - make_interval(days => ${STALLED_DAYS}))::int AS stalled,
  count(${e}.id) FILTER (WHERE ${e}.status = 'completed')::int AS completed,
  count(${e}.id) FILTER (WHERE ${e}.status = 'dropped')::int AS dropped,
  count(${e}.id) FILTER (WHERE ${e}.started_at >= $2)::int AS "newEnrollments",
  count(${e}.id) FILTER (WHERE ${e}.completed_at >= $2)::int AS "recentCompletions",
  COALESCE(round(avg(${e}.progress_percent) FILTER (WHERE ${e}.status <> 'dropped'), 1), 0)::float AS "avgProgress",
  round((percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM ${e}.completed_at - ${e}.started_at) / 86400
  ) FILTER (WHERE ${e}.status = 'completed'))::numeric, 1)::float AS "medianDaysToComplete"`;

interface StatusCounts {
  enrolled: number;
  notStarted: number;
  inProgress: number;
  stalled: number;
  completed: number;
  dropped: number;
  newEnrollments: number;
  recentCompletions: number;
  avgProgress: number;
  medianDaysToComplete: number | null;
}

export interface CourseReportRow extends StatusCounts {
  id: string;
  title: string;
  status: string;
  outOfOrder: number;
  certificates: number;
  recentCertificates: number;
}

export interface RoadmapReportRow extends StatusCounts {
  id: string;
  title: string;
  status: string;
  outOfOrder: number;
  certificates: number;
  recentCertificates: number;
  /** Người đã ghi danh lộ trình: bao nhiêu người bắt đầu / hoàn thành khóa ở từng vị trí. */
  funnel: { position: number; title: string; isOptional: boolean; started: number; completed: number; outOfOrder: number }[];
}

export interface LearningReport {
  days: number;
  stalledDays: number;
  summary: {
    courseEnrollments: number;
    notStarted: number;
    inProgress: number;
    stalled: number;
    completed: number;
    dropped: number;
    completionRate: number;
    newEnrollments: number;
    recentCompletions: number;
    certificates: number;
    recentCertificates: number;
    roadmapEnrollments: number;
    roadmapsCompleted: number;
    outOfOrderStarts: number;
  };
  courses: CourseReportRow[];
  roadmaps: RoadmapReportRow[];
}

/**
 * Báo cáo học tập: hoàn thành, học dở, ngưng học, chứng chỉ, bỏ qua thứ tự lộ trình.
 *
 * `ownerId` = phạm vi giảng viên (`created_by`), `null` = toàn nền tảng (chỉ admin, controller
 * quyết định). Cùng quy tắc với `LecturerInsightsService`: admin mở trang giảng viên vẫn chỉ
 * thấy nội dung của chính mình.
 */
@Injectable()
export class LearningReportService {
  constructor(private readonly prisma: PrismaService) {}

  async get(ownerId: string | null, days: number): Promise<LearningReport> {
    const [{ since }] = await this.prisma.$queryRaw<{ since: Date }[]>`
      SELECT (date_trunc('day', now() AT TIME ZONE ${TIMEZONE})
              - make_interval(days => ${days - 1}::int)) AT TIME ZONE ${TIMEZONE} AS since`;

    const [courses, roadmaps, funnel] = await Promise.all([
      this.prisma.$queryRawUnsafe<CourseReportRow[]>(
        `SELECT c.id, c.title, c.status::text AS status, ${STATUS_COUNTS('e')},
           count(e.id) FILTER (WHERE e.started_out_of_order)::int AS "outOfOrder",
           (SELECT count(*) FROM certificates k WHERE k.subject = 'course' AND k.subject_id = c.id
              AND k.revoked_at IS NULL)::int AS certificates,
           (SELECT count(*) FROM certificates k WHERE k.subject = 'course' AND k.subject_id = c.id
              AND k.revoked_at IS NULL AND k.issued_at >= $2)::int AS "recentCertificates"
         FROM courses c LEFT JOIN course_enrollments e ON e.course_id = c.id
         WHERE ($1::uuid IS NULL OR c.created_by = $1::uuid) AND c.status <> 'draft'
         GROUP BY c.id ORDER BY enrolled DESC, c.title`,
        ownerId,
        since,
      ),
      this.prisma.$queryRawUnsafe<Omit<RoadmapReportRow, 'funnel'>[]>(
        `SELECT r.id, r.title, r.status::text AS status, ${STATUS_COUNTS('e')},
           (SELECT count(*) FROM course_enrollments ce WHERE ce.via_roadmap_id = r.id
              AND ce.started_out_of_order)::int AS "outOfOrder",
           (SELECT count(*) FROM certificates k WHERE k.subject = 'roadmap' AND k.subject_id = r.id
              AND k.revoked_at IS NULL)::int AS certificates,
           (SELECT count(*) FROM certificates k WHERE k.subject = 'roadmap' AND k.subject_id = r.id
              AND k.revoked_at IS NULL AND k.issued_at >= $2)::int AS "recentCertificates"
         FROM roadmaps r LEFT JOIN roadmap_enrollments e ON e.roadmap_id = r.id
         WHERE ($1::uuid IS NULL OR r.created_by = $1::uuid) AND r.status <> 'draft'
         GROUP BY r.id ORDER BY enrolled DESC, r.title`,
        ownerId,
        since,
      ),
      this.prisma.$queryRawUnsafe<
        { roadmapId: string; position: number; title: string; isOptional: boolean; started: number; completed: number; outOfOrder: number }[]
      >(
        `SELECT rc.roadmap_id AS "roadmapId", rc.position, c.title, rc.is_optional AS "isOptional",
           count(ce.id) FILTER (WHERE ce.status <> 'dropped')::int AS started,
           count(ce.id) FILTER (WHERE ce.status = 'completed')::int AS completed,
           count(ce.id) FILTER (WHERE ce.started_out_of_order AND ce.via_roadmap_id = rc.roadmap_id)::int AS "outOfOrder"
         FROM roadmap_courses rc
         JOIN roadmaps r ON r.id = rc.roadmap_id
         JOIN courses c ON c.id = rc.course_id
         LEFT JOIN roadmap_enrollments re ON re.roadmap_id = rc.roadmap_id AND re.status <> 'dropped'
         LEFT JOIN course_enrollments ce ON ce.user_id = re.user_id AND ce.course_id = rc.course_id
         WHERE ($1::uuid IS NULL OR r.created_by = $1::uuid) AND r.status <> 'draft'
         GROUP BY rc.roadmap_id, rc.position, c.title, rc.is_optional
         ORDER BY rc.roadmap_id, rc.position`,
        ownerId,
      ),
    ]);

    const roadmapRows: RoadmapReportRow[] = roadmaps.map((row) => ({
      ...row,
      funnel: funnel
        .filter((step) => step.roadmapId === row.id)
        .map(({ roadmapId: _, ...step }) => step),
    }));
    return { days, stalledDays: STALLED_DAYS, summary: summarize(courses, roadmapRows), courses, roadmaps: roadmapRows };
  }
}

/** Tổng của các dòng — tách riêng để kiểm bằng test mà không cần CSDL. */
export function summarize(courses: CourseReportRow[], roadmaps: RoadmapReportRow[]): LearningReport['summary'] {
  const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const enrolled = sum(courses, (c) => c.enrolled);
  const completed = sum(courses, (c) => c.completed);
  return {
    courseEnrollments: enrolled,
    notStarted: sum(courses, (c) => c.notStarted),
    inProgress: sum(courses, (c) => c.inProgress),
    stalled: sum(courses, (c) => c.stalled),
    completed,
    dropped: sum(courses, (c) => c.dropped),
    // Trên số ghi danh còn hiệu lực (không tính bỏ học), một chữ số thập phân.
    completionRate: enrolled === 0 ? 0 : Math.round((completed / enrolled) * 1000) / 10,
    newEnrollments: sum(courses, (c) => c.newEnrollments),
    recentCompletions: sum(courses, (c) => c.recentCompletions),
    certificates: sum(courses, (c) => c.certificates) + sum(roadmaps, (r) => r.certificates),
    recentCertificates: sum(courses, (c) => c.recentCertificates) + sum(roadmaps, (r) => r.recentCertificates),
    roadmapEnrollments: sum(roadmaps, (r) => r.enrolled),
    roadmapsCompleted: sum(roadmaps, (r) => r.completed),
    outOfOrderStarts: sum(courses, (c) => c.outOfOrder),
  };
}
