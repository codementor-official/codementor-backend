import { Injectable } from '@nestjs/common';
import { PrismaService, mapDatabaseError } from '@codementor/platform';
import type { CertificateDesign } from '../domain/certificate-design';

export type CertificateSubject = 'course' | 'roadmap';

export interface CertificateTemplateRow {
  id: string;
  ownerId: string | null;
  name: string;
  subject: CertificateSubject | null;
  design: CertificateDesign;
  usage: number;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = `
  t.id, t.owner_id AS "ownerId", t.name, t.subject::text AS subject, t.design,
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  ((SELECT count(*) FROM courses c WHERE c.certificate_template_id = t.id)
   + (SELECT count(*) FROM roadmaps r WHERE r.certificate_template_id = t.id))::int AS usage`;

/** Bảng `certificate_templates` và hai cột gắn mẫu trên `courses`/`roadmaps` (migration 0048). */
@Injectable()
export class CertificateTemplateStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Mẫu mặc định trước, rồi mẫu của chính người hỏi, mới sửa trước. */
  list(ownerId: string): Promise<CertificateTemplateRow[]> {
    return this.prisma.$queryRawUnsafe<CertificateTemplateRow[]>(
      `SELECT ${COLUMNS} FROM certificate_templates t
       WHERE t.archived_at IS NULL AND (t.owner_id IS NULL OR t.owner_id = $1::uuid)
       ORDER BY (t.owner_id IS NULL) DESC, t.updated_at DESC`,
      ownerId,
    );
  }

  async find(id: string): Promise<CertificateTemplateRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<CertificateTemplateRow[]>(
      `SELECT ${COLUMNS} FROM certificate_templates t WHERE t.id = $1::uuid AND t.archived_at IS NULL`,
      id,
    );
    return rows[0] ?? null;
  }

  async findDefault(): Promise<CertificateTemplateRow> {
    const rows = await this.prisma.$queryRawUnsafe<CertificateTemplateRow[]>(
      `SELECT ${COLUMNS} FROM certificate_templates t WHERE t.owner_id IS NULL`,
    );
    // Migration 0048 seed đúng một mẫu mặc định; thiếu nó là CSDL hỏng, không phải lỗi người dùng.
    if (!rows[0]) throw new Error('Thiếu mẫu chứng chỉ mặc định (migration 0048)');
    return rows[0];
  }

  async insert(input: {
    ownerId: string;
    name: string;
    subject: CertificateSubject | null;
    design: CertificateDesign;
  }): Promise<string> {
    try {
      const [row] = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO certificate_templates (owner_id, name, subject, design)
        VALUES (${input.ownerId}::uuid, ${input.name}, ${input.subject}::certificate_subject,
                ${JSON.stringify(input.design)}::jsonb)
        RETURNING id`;
      return row.id;
    } catch (cause) {
      throw mapDatabaseError(cause);
    }
  }

  async update(
    id: string,
    input: { name: string; subject: CertificateSubject | null; design: CertificateDesign },
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE certificate_templates
      SET name = ${input.name}, subject = ${input.subject}::certificate_subject,
          design = ${JSON.stringify(input.design)}::jsonb, updated_at = now()
      WHERE id = ${id}::uuid`;
  }

  /**
   * Lưu trữ thay vì xóa: chứng chỉ đã cấp trỏ `template_id` về đây. Khóa/lộ trình đang gắn
   * mẫu này quay về mẫu mặc định.
   */
  async archive(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw`UPDATE courses SET certificate_template_id = NULL WHERE certificate_template_id = ${id}::uuid`,
      this.prisma.$executeRaw`UPDATE roadmaps SET certificate_template_id = NULL WHERE certificate_template_id = ${id}::uuid`,
      this.prisma.$executeRaw`UPDATE certificate_templates SET archived_at = now() WHERE id = ${id}::uuid`,
    ]);
  }

  async findOwner(
    subject: CertificateSubject,
    id: string,
  ): Promise<{ createdBy: string | null; templateId: string | null } | null> {
    const rows =
      subject === 'course'
        ? await this.prisma.$queryRaw<{ createdBy: string | null; templateId: string | null }[]>`
            SELECT created_by AS "createdBy", certificate_template_id AS "templateId"
            FROM courses WHERE id = ${id}::uuid`
        : await this.prisma.$queryRaw<{ createdBy: string | null; templateId: string | null }[]>`
            SELECT created_by AS "createdBy", certificate_template_id AS "templateId"
            FROM roadmaps WHERE id = ${id}::uuid`;
    return rows[0] ?? null;
  }

  async attach(subject: CertificateSubject, id: string, templateId: string | null): Promise<void> {
    if (subject === 'course') {
      await this.prisma.$executeRaw`UPDATE courses SET certificate_template_id = ${templateId}::uuid WHERE id = ${id}::uuid`;
    } else {
      await this.prisma.$executeRaw`UPDATE roadmaps SET certificate_template_id = ${templateId}::uuid WHERE id = ${id}::uuid`;
    }
  }
}
