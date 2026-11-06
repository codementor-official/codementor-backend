import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import { TOPICS, type CertificateIssuedV1 } from '@codementor/contracts';
import type { CertificateDesign } from '../domain/certificate-design';
import type { CertificateSubject } from './certificate-template.store';

/** Dữ liệu thô lưu trong `certificates.data` — ngày ISO, client định dạng lúc vẽ. */
export interface CertificateData {
  learnerName: string;
  subjectKind: CertificateSubject;
  subjectTitle: string;
  instructorName: string;
  startedAt: string | null;
  completedAt: string | null;
  durationHours: number | null;
  issuedAt: string;
  certificateCode: string;
}

export interface SubjectInfo {
  title: string;
  instructorName: string;
  durationHours: number | null;
  status: string;
  templateId: string;
  design: CertificateDesign;
}

export interface Completion {
  status: string;
  progressPercent: number;
  startedAt: Date;
  completedAt: Date | null;
}

export interface CertificateRow {
  id: string;
  code: string;
  userId: string;
  subject: CertificateSubject;
  subjectId: string;
  recipientName: string;
  data: CertificateData;
  design: CertificateDesign;
  issuedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
}

const CERT_COLUMNS = `
  c.id, c.code, c.user_id AS "userId", c.subject::text AS subject, c.subject_id AS "subjectId",
  c.recipient_name AS "recipientName", c.data, c.design, c.issued_at AS "issuedAt",
  c.revoked_at AS "revokedAt", c.revoke_reason AS "revokeReason"`;

/**
 * Cấp và tra cứu chứng chỉ. Đọc chéo `users` (tên giảng viên, external_id cho sự kiện) như các
 * truy vấn báo cáo khác của service này — chỉ đọc.
 */
@Injectable()
export class CertificateStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tên, giảng viên, thời lượng và mẫu đang áp: mẫu gắn riêng, không có thì mẫu mặc định.
   * Giảng viên của khóa là `instructor_id`, thiếu thì người tạo; lộ trình là người tạo.
   */
  async subject(subject: CertificateSubject, id: string): Promise<SubjectInfo | null> {
    const defaults = `(SELECT id, design FROM certificate_templates WHERE owner_id IS NULL) d`;
    const rows =
      subject === 'course'
        ? await this.prisma.$queryRawUnsafe<SubjectInfo[]>(
            `SELECT x.title, COALESCE(iu.display_name, cu.display_name, 'CodeMentor') AS "instructorName",
                    x.duration_hours::float AS "durationHours", x.status::text AS status,
                    COALESCE(t.id, d.id) AS "templateId", COALESCE(t.design, d.design) AS design
             FROM courses x
             LEFT JOIN users iu ON iu.id = x.instructor_id
             LEFT JOIN users cu ON cu.id = x.created_by
             LEFT JOIN certificate_templates t ON t.id = x.certificate_template_id AND t.archived_at IS NULL
             CROSS JOIN ${defaults}
             WHERE x.id = $1::uuid`,
            id,
          )
        : await this.prisma.$queryRawUnsafe<SubjectInfo[]>(
            `SELECT x.title, COALESCE(cu.display_name, 'CodeMentor') AS "instructorName",
                    x.estimated_hours::float AS "durationHours", x.status::text AS status,
                    COALESCE(t.id, d.id) AS "templateId", COALESCE(t.design, d.design) AS design
             FROM roadmaps x
             LEFT JOIN users cu ON cu.id = x.created_by
             LEFT JOIN certificate_templates t ON t.id = x.certificate_template_id AND t.archived_at IS NULL
             CROSS JOIN ${defaults}
             WHERE x.id = $1::uuid`,
            id,
          );
    return rows[0] ?? null;
  }

  async completion(userId: string, subject: CertificateSubject, id: string): Promise<Completion | null> {
    const table = subject === 'course' ? 'course_enrollments' : 'roadmap_enrollments';
    const column = subject === 'course' ? 'course_id' : 'roadmap_id';
    const rows = await this.prisma.$queryRawUnsafe<Completion[]>(
      `SELECT status::text AS status, progress_percent::float AS "progressPercent",
              started_at AS "startedAt", completed_at AS "completedAt"
       FROM ${table} WHERE user_id = $1::uuid AND ${column} = $2::uuid AND status <> 'dropped'`,
      userId,
      id,
    );
    return rows[0] ?? null;
  }

  async findActive(userId: string, subject: CertificateSubject, id: string): Promise<CertificateRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<CertificateRow[]>(
      `SELECT ${CERT_COLUMNS} FROM certificates c
       WHERE c.user_id = $1::uuid AND c.subject = $2::certificate_subject AND c.subject_id = $3::uuid
         AND c.revoked_at IS NULL`,
      userId,
      subject,
      id,
    );
    return rows[0] ?? null;
  }

  async findByCode(code: string): Promise<CertificateRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<CertificateRow[]>(
      `SELECT ${CERT_COLUMNS} FROM certificates c WHERE c.code = $1`,
      code,
    );
    return rows[0] ?? null;
  }

  listMine(userId: string): Promise<CertificateRow[]> {
    return this.prisma.$queryRawUnsafe<CertificateRow[]>(
      `SELECT ${CERT_COLUMNS} FROM certificates c
       WHERE c.user_id = $1::uuid AND c.revoked_at IS NULL ORDER BY c.issued_at DESC`,
      userId,
    );
  }

  /**
   * Ghi chứng chỉ và sự kiện `CERTIFICATE_ISSUED` vào outbox trong CÙNG transaction: hỏng một
   * bên thì cả hai cùng không có — không có email chúc mừng cho chứng chỉ không tồn tại.
   * Vi phạm unique (đã có chứng chỉ, hoặc trùng mã) ném nguyên lỗi Prisma cho người gọi xử lý.
   */
  async issue(input: {
    userId: string;
    subject: CertificateSubject;
    subjectId: string;
    templateId: string;
    recipientName: string;
    code: string;
    data: CertificateData;
    design: CertificateDesign;
  }): Promise<CertificateRow> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRawUnsafe<CertificateRow[]>(
        `INSERT INTO certificates (code, user_id, subject, subject_id, template_id, recipient_name, data, design, issued_at)
         VALUES ($1, $2::uuid, $3::certificate_subject, $4::uuid, $5::uuid, $6, $7::jsonb, $8::jsonb, $9::timestamptz)
         RETURNING id, code, user_id AS "userId", subject::text AS subject, subject_id AS "subjectId",
                   recipient_name AS "recipientName", data, design, issued_at AS "issuedAt",
                   revoked_at AS "revokedAt", revoke_reason AS "revokeReason"`,
        input.code,
        input.userId,
        input.subject,
        input.subjectId,
        input.templateId,
        input.recipientName,
        JSON.stringify(input.data),
        JSON.stringify(input.design),
        input.data.issuedAt,
      );
      const [user] = await tx.$queryRaw<{ externalId: string | null }[]>`
        SELECT external_id::text AS "externalId" FROM users WHERE id = ${input.userId}::uuid`;
      if (user?.externalId) {
        const eventId = randomUUID();
        const payload: CertificateIssuedV1 = {
          recipientExternalId: user.externalId,
          certificateId: row.id,
          code: row.code,
          subject: input.subject,
          subjectId: input.subjectId,
          subjectTitle: input.data.subjectTitle,
          recipientName: input.recipientName,
        };
        const envelope = {
          eventId,
          eventName: TOPICS.CERTIFICATE_ISSUED,
          occurredAt: new Date().toISOString(),
          correlationId: row.id,
          producer: 'learning-service',
          payload,
        };
        await tx.$executeRaw`
          INSERT INTO outbox (id, topic, partition_key, payload)
          VALUES (${eventId}::uuid, ${TOPICS.CERTIFICATE_ISSUED}, ${user.externalId}, ${JSON.stringify(envelope)}::jsonb)`;
      }
      return row;
    });
  }

  /** Danh sách cho admin: mới cấp trước, tìm theo mã / tên in / email / tên khóa-lộ trình. */
  async adminList(query: { q?: string; limit: number; offset: number }): Promise<{
    items: (CertificateRow & { email: string | null })[];
    total: number;
  }> {
    const q = query.q?.trim() ? `%${query.q.trim()}%` : null;
    const where = `($1::text IS NULL OR c.code ILIKE $1 OR c.recipient_name ILIKE $1
                   OR u.email ILIKE $1 OR c.data->>'subjectTitle' ILIKE $1)`;
    const [items, [count]] = await Promise.all([
      this.prisma.$queryRawUnsafe<(CertificateRow & { email: string | null })[]>(
        `SELECT ${CERT_COLUMNS}, u.email FROM certificates c LEFT JOIN users u ON u.id = c.user_id
         WHERE ${where} ORDER BY c.issued_at DESC LIMIT $2 OFFSET $3`,
        q,
        query.limit,
        query.offset,
      ),
      this.prisma.$queryRawUnsafe<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM certificates c LEFT JOIN users u ON u.id = c.user_id WHERE ${where}`,
        q,
      ),
    ]);
    return { items, total: count.total };
  }

  /** `false` khi không có chứng chỉ đang hiệu lực mang id đó. */
  async revoke(id: string, adminId: string, reason: string): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE certificates SET revoked_at = now(), revoked_by = ${adminId}::uuid, revoke_reason = ${reason}
      WHERE id = ${id}::uuid AND revoked_at IS NULL`;
    return changed > 0;
  }
}
