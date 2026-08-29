import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, mapDatabaseError } from '@codementor/platform';
import { Roadmap } from '../domain/model/roadmap';
import type {
  ContentStatus,
  CurrentLevel,
  ProgressionMode,
  RoadmapField,
} from '../domain/model/roadmap';
import type {
  RoadmapCourseInput,
  RoadmapCourseItem,
  RoadmapListFilter,
  RoadmapListItem,
  RoadmapRepository,
} from '../domain/port/roadmap.repository';

interface RoadmapRow {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description: string | null;
  field: string;
  level: string;
  cover_image_url: string | null;
  estimated_hours: number | null;
  progression_mode: string;
  prerequisite_note: string | null;
  status: string;
  created_by: string | null;
  rejection_reason: string | null;
  published_at: Date | null;
  tag_ids?: string[] | null;
  updated_at: Date;
}

@Injectable()
export class PrismaRoadmapRepository implements RoadmapRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Roadmap | null> {
    const rows = await this.prisma.$queryRaw<RoadmapRow[]>`
      SELECT r.id, r.slug::text AS slug, r.title, r.short_description, r.description,
             r.field::text AS field, r.level::text AS level, r.cover_image_url, r.estimated_hours,
             r.progression_mode::text AS progression_mode, r.prerequisite_note,
             r.status::text AS status, r.created_by, r.rejection_reason, r.published_at,
             r.updated_at,
             COALESCE(
               (SELECT array_agg(rt.tag_id::text ORDER BY rt.tag_id)
                FROM roadmap_tags rt WHERE rt.roadmap_id = r.id),
               '{}') AS tag_ids
      FROM roadmaps r WHERE r.id = ${id}::uuid LIMIT 1`;
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM roadmaps WHERE slug = ${slug}::citext LIMIT 1`;
    return rows.length > 0;
  }

  async list(filter: RoadmapListFilter): Promise<RoadmapListItem[]> {
    const where: Prisma.Sql[] = [];
    if (filter.createdBy !== null) where.push(Prisma.sql`r.created_by = ${filter.createdBy}::uuid`);
    if (filter.publishedOnly) where.push(Prisma.sql`r.status = 'published'`);
    if (filter.pendingOnly) where.push(Prisma.sql`r.status = 'pending_review'`);
    if (filter.excludeDraft && !filter.status) where.push(Prisma.sql`r.status <> 'draft'`);
    if (filter.field) where.push(Prisma.sql`r.field = ${filter.field}::roadmap_field`);
    if (filter.level) where.push(Prisma.sql`r.level = ${filter.level}::current_level`);
    if (filter.status) where.push(Prisma.sql`r.status = ${filter.status}::content_status`);
    if (filter.authorId) where.push(Prisma.sql`r.created_by = ${filter.authorId}::uuid`);
    if (filter.updatedFrom) where.push(Prisma.sql`r.updated_at >= ${filter.updatedFrom}::timestamptz`);
    if (filter.updatedTo) where.push(Prisma.sql`r.updated_at <= ${filter.updatedTo}::timestamptz`);
    if (filter.q) {
      where.push(
        Prisma.sql`(r.title ILIKE ${'%' + filter.q + '%'} OR r.slug::text ILIKE ${'%' + filter.q + '%'})`,
      );
    }
    // Hàng chờ xếp cũ trước: ai gửi sớm được xem trước.
    const oldestFirst = filter.pendingOnly === true;
    if (filter.cursor) {
      where.push(
        oldestFirst
          ? Prisma.sql`(r.updated_at, r.id) > (${filter.cursor.updatedAt}::timestamptz, ${filter.cursor.id}::uuid)`
          : Prisma.sql`(r.updated_at, r.id) < (${filter.cursor.updatedAt}::timestamptz, ${filter.cursor.id}::uuid)`,
      );
    }
    const clause = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const order = oldestFirst
      ? Prisma.sql`ORDER BY r.updated_at ASC, r.id ASC`
      : Prisma.sql`ORDER BY r.updated_at DESC, r.id DESC`;

    return this.prisma.$queryRaw<RoadmapListItem[]>`
      SELECT r.id, r.slug::text AS slug, r.title,
             r.short_description AS "shortDescription", r.cover_image_url AS "coverImageUrl",
             r.field::text AS field, r.level::text AS level,
             r.status::text AS status, r.estimated_hours AS "estimatedHours",
             (SELECT count(*)::int FROM roadmap_courses rc WHERE rc.roadmap_id = r.id) AS "courseCount",
             r.created_by AS "createdBy", u.display_name AS "authorName",
             (r.status = 'published' AND r.rejection_reason IS NOT NULL) AS "removalRequested", r.updated_at AS "updatedAt"
      FROM roadmaps r
      LEFT JOIN users u ON u.id = r.created_by
      ${clause}
      ${order}
      LIMIT ${filter.limit + 1}`;
  }

  async listCourses(roadmapId: string): Promise<RoadmapCourseItem[]> {
    return this.prisma.$queryRaw<RoadmapCourseItem[]>`
      SELECT rc.course_id AS "courseId", rc.position, rc.is_optional AS "isOptional",
             c.title, c.slug::text AS slug, c.status::text AS status,
             c.duration_hours AS "durationHours"
      FROM roadmap_courses rc
      JOIN courses c ON c.id = rc.course_id
      WHERE rc.roadmap_id = ${roadmapId}::uuid
      ORDER BY rc.position`;
  }

  /**
   * Xoá hết rồi chèn lại, trong một transaction.
   *
   * Cách này đơn giản hơn hẳn so với so khớp từng dòng thêm/xoá/đổi vị trí, và đúng với
   * cách studio làm việc: người dùng kéo thả xong bấm lưu một lần. `roadmap_courses`
   * không có dữ liệu riêng nào ngoài `position` và `is_optional` nên xoá đi chèn lại
   * không mất gì — tiến độ học nằm ở `roadmap_enrollments`, bảng khác.
   */
  async replaceCourses(roadmapId: string, courses: RoadmapCourseInput[]): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.$executeRaw`DELETE FROM roadmap_courses WHERE roadmap_id = ${roadmapId}::uuid`,
        ...courses.map(
          (course, index) => this.prisma.$executeRaw`
            INSERT INTO roadmap_courses (roadmap_id, course_id, position, is_optional)
            VALUES (${roadmapId}::uuid, ${course.courseId}::uuid, ${index + 1}, ${course.isOptional})`,
        ),
      ]);
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
  }

  async save(roadmap: Roadmap): Promise<void> {
    try {
      // Một giao dịch: lộ trình và chủ đề của nó cùng sống hoặc cùng chết.
      await this.prisma.$transaction([
        this.prisma.$executeRaw`
        INSERT INTO roadmaps (id, slug, title, short_description, description, field, level,
                              cover_image_url, estimated_hours, progression_mode, prerequisite_note,
                              status, created_by, rejection_reason, published_at)
        VALUES (${roadmap.id}::uuid, ${roadmap.slug}::citext, ${roadmap.title},
                ${roadmap.shortDescription}, ${roadmap.description}, ${roadmap.field}::roadmap_field,
                ${roadmap.level}::current_level, ${roadmap.coverImageUrl}, ${roadmap.estimatedHours},
                ${roadmap.progressionMode}::progression_mode, ${roadmap.prerequisiteNote},
                ${roadmap.status}::content_status, ${roadmap.createdBy}::uuid,
                ${roadmap.rejectionReason}, ${roadmap.publishedAt})
        ON CONFLICT (id) DO UPDATE SET
          slug              = EXCLUDED.slug,
          title             = EXCLUDED.title,
          short_description = EXCLUDED.short_description,
          description       = EXCLUDED.description,
          field             = EXCLUDED.field,
          level             = EXCLUDED.level,
          cover_image_url   = EXCLUDED.cover_image_url,
          estimated_hours   = EXCLUDED.estimated_hours,
          progression_mode  = EXCLUDED.progression_mode,
          prerequisite_note = EXCLUDED.prerequisite_note,
          status            = EXCLUDED.status,
          rejection_reason  = EXCLUDED.rejection_reason,
          published_at      = EXCLUDED.published_at,
          updated_at        = now()`,
        this.prisma.$executeRaw`
          DELETE FROM roadmap_tags
          WHERE roadmap_id = ${roadmap.id}::uuid
            AND tag_id <> ALL (${roadmap.tagIds}::uuid[])`,
        this.prisma.$executeRaw`
          INSERT INTO roadmap_tags (roadmap_id, tag_id)
          SELECT ${roadmap.id}::uuid, tag_id
          FROM unnest(${roadmap.tagIds}::uuid[]) AS tag_id
          ON CONFLICT DO NOTHING`,
      ]);
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`DELETE FROM roadmaps WHERE id = ${id}::uuid`;
    } catch (error) {
      // `onDelete` là bắt buộc: 23503 ở chiều xoá nghĩa là "còn thứ khác đang dùng"
      // (409), không phải "trỏ tới thứ không tồn tại" (400).
      throw mapDatabaseError(error, { onDelete: true, resource: 'Lộ trình' }) ?? error;
    }
  }

  private toDomain(row: RoadmapRow): Roadmap {
    return Roadmap.rehydrate(row.id, {
      slug: row.slug,
      title: row.title,
      shortDescription: row.short_description,
      description: row.description,
      field: row.field as RoadmapField,
      level: row.level as CurrentLevel,
      coverImageUrl: row.cover_image_url,
      estimatedHours: row.estimated_hours,
      progressionMode: row.progression_mode as ProgressionMode,
      tagIds: row.tag_ids ?? [],
      prerequisiteNote: row.prerequisite_note,
      status: row.status as ContentStatus,
      createdBy: row.created_by,
      rejectionReason: row.rejection_reason,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    });
  }
}
