import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import { reportCooldownLeft } from './report-rules';
import { REPORT_TARGET_COLUMNS, REPORT_TARGET_JOINS } from './report-moderation.service';

export const REPORT_TARGET_TYPES = [
  'DOCUMENT',
  'POST',
  'COURSE',
  'ROADMAP',
  'EXERCISE',
  'WORKSPACE',
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_CATEGORIES = [
  'SPAM',
  'MISLEADING',
  'INAPPROPRIATE',
  'COPYRIGHT',
  'OTHER',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_STATUSES = ['PENDING', 'RESOLVED', 'REJECTED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

interface ContentReportRow {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  targetRef: string | null;
  category: ReportCategory;
  note: string | null;
  status: 'PENDING' | 'RESOLVED' | 'REJECTED';
  reporterName?: string;
  reporterEmail?: string;
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ContentReportService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(
    reporterId: string,
    input: {
      targetType: ReportTargetType;
      targetId: string;
      targetRef?: string;
      category: ReportCategory;
      note?: string;
    },
  ) {
    // Khoá theo người báo cáo trong transaction: hai request song song không cùng lọt qua bước
    // kiểm tra rồi cùng ghi.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`content-report:${reporterId}`}))`;
      const [last] = await tx.$queryRaw<Array<{ at: Date | null }>>`
        SELECT max(submitted_at) AS at FROM content_reports WHERE reporter_id = ${reporterId}::uuid`;
      const wait = reportCooldownLeft(last?.at ?? null, new Date());
      if (wait > 0) {
        const minutes = Math.ceil(wait / 60);
        throw new HttpException(
          {
            message: `Mỗi tài khoản chỉ gửi được một báo cáo trong 10 phút. Vui lòng thử lại sau ${minutes} phút.`,
            retryAfterSeconds: wait,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const [inserted] = await tx.$queryRawUnsafe<ContentReportRow[]>(
        `INSERT INTO content_reports
         (reporter_id, target_type, target_id, target_ref, category, note, status, submitted_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, 'PENDING', now())
       ON CONFLICT (reporter_id, target_type, target_id) DO UPDATE SET
         submitted_at = now(),
         target_ref = COALESCE(EXCLUDED.target_ref, content_reports.target_ref),
         category = EXCLUDED.category,
         note = EXCLUDED.note,
         status = 'PENDING',
         resolution_note = NULL,
         resolved_by = NULL,
         resolved_at = NULL,
         updated_at = now()
       RETURNING id, target_type AS "targetType", target_id AS "targetId",
                 target_ref AS "targetRef", category, note, status,
                 resolution_note AS "resolutionNote", resolved_by AS "resolvedBy",
                 resolved_at AS "resolvedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
        reporterId,
        input.targetType,
        input.targetId,
        input.targetRef?.trim() || null,
        input.category,
        input.note?.trim() || null,
      );
      return inserted;
    });
    return this.serialize(row);
  }

  async list(reporterId: string, page: number, limit: number) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const offset = (safePage - 1) * safeLimit;
    const [items, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<ContentReportRow[]>(
        `SELECT id, target_type AS "targetType", target_id AS "targetId",
                target_ref AS "targetRef", category, note, status,
                resolution_note AS "resolutionNote", resolved_by AS "resolvedBy",
                resolved_at AS "resolvedAt",
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM content_reports
         WHERE reporter_id = $1::uuid
         ORDER BY updated_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        reporterId,
        safeLimit,
        offset,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
        'SELECT count(*) AS total FROM content_reports WHERE reporter_id = $1::uuid',
        reporterId,
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: items.map((item) => this.serialize(item)),
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async adminList(input: {
    status?: ContentReportRow['status'];
    targetType?: ReportTargetType;
    category?: ReportCategory;
    q?: string;
    page: number;
    limit: number;
  }) {
    const page = Math.max(input.page, 1);
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const offset = (page - 1) * limit;
    const values: unknown[] = [];
    const where: string[] = [];
    const bind = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (input.status) where.push(`r.status = ${bind(input.status)}`);
    if (input.targetType) where.push(`r.target_type = ${bind(input.targetType)}`);
    if (input.category) where.push(`r.category = ${bind(input.category)}`);
    if (input.q?.trim()) {
      const token = bind(`%${input.q.trim()}%`);
      where.push(`(r.target_ref ILIKE ${token} OR r.note ILIKE ${token} OR u.email ILIKE ${token} OR u.display_name ILIKE ${token}
        OR COALESCE(c.title, rm.title, e.title, a.title, g.name, d.title, '') ILIKE ${token})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [items, countRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<ContentReportRow[]>(
        `SELECT r.id, r.target_type AS "targetType", r.target_id AS "targetId",
                r.target_ref AS "targetRef", r.category, r.note, r.status,
                r.resolution_note AS "resolutionNote", r.resolved_by AS "resolvedBy",
                r.resolved_at AS "resolvedAt", r.created_at AS "createdAt",
                r.updated_at AS "updatedAt", u.display_name AS "reporterName",
                u.email AS "reporterEmail", ${REPORT_TARGET_COLUMNS}
         FROM content_reports r
         JOIN users u ON u.id = r.reporter_id
         ${REPORT_TARGET_JOINS}
         ${clause}
         ORDER BY CASE WHEN r.status = 'PENDING' THEN 0 ELSE 1 END, r.updated_at DESC, r.id DESC
         LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
        ...values,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
        `SELECT count(*) AS total FROM content_reports r JOIN users u ON u.id = r.reporter_id ${REPORT_TARGET_JOINS} ${clause}`,
        ...values.slice(0, values.length - 2),
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    return {
      items: items.map((item) => this.serialize(item)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  private serialize(row: ContentReportRow) {
    return {
      ...row,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
