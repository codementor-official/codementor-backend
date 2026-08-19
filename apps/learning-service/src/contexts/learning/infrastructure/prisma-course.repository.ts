import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService, mapDatabaseError } from '@codementor/platform';
import { Course } from '../domain/model/course';
import type { ContentStatus, CurrentLevel, ProgressionMode } from '../domain/model/roadmap';
import type { ChapterDraft } from '../domain/model/curriculum';
import type {
  CourseListFilter,
  CourseListItem,
  CourseRepository,
  StoredChapter,
  StoredLesson,
} from '../domain/port/course.repository';

interface CourseRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  level: string;
  duration_hours: number | null;
  instructor_id: string | null;
  prerequisite_note: string | null;
  progression_mode: string;
  status: string;
  created_by: string | null;
  rejection_reason: string | null;
  published_at: Date | null;
  total_chapters: number;
  total_lessons: number;
  updated_at: Date;
}

interface ChapterRow {
  id: string;
  title: string;
  description: string | null;
  is_optional: boolean;
  position: number;
}

interface LessonRow extends StoredLesson {
  chapterId: string;
}

@Injectable()
export class PrismaCourseRepository implements CourseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Course | null> {
    const rows = await this.prisma.$queryRaw<CourseRow[]>`
      SELECT id, slug::text AS slug, title, description, cover_image_url, level::text AS level,
             duration_hours, instructor_id, prerequisite_note,
             progression_mode::text AS progression_mode, status::text AS status,
             created_by, rejection_reason, published_at, total_chapters, total_lessons, updated_at
      FROM courses WHERE id = ${id}::uuid LIMIT 1`;
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM courses WHERE slug = ${slug}::citext LIMIT 1`;
    return rows.length > 0;
  }

  async list(filter: CourseListFilter): Promise<CourseListItem[]> {
    const where: Prisma.Sql[] = [];
    if (filter.createdBy !== null) where.push(Prisma.sql`c.created_by = ${filter.createdBy}::uuid`);
    if (filter.publishedOnly) where.push(Prisma.sql`c.status = 'published'`);
    if (filter.pendingOnly) where.push(Prisma.sql`c.status = 'pending_review'`);
    if (filter.excludeDraft && !filter.status) where.push(Prisma.sql`c.status <> 'draft'`);
    if (filter.level) where.push(Prisma.sql`c.level = ${filter.level}::current_level`);
    if (filter.status) where.push(Prisma.sql`c.status = ${filter.status}::content_status`);
    if (filter.authorId) where.push(Prisma.sql`c.created_by = ${filter.authorId}::uuid`);
    if (filter.updatedFrom) where.push(Prisma.sql`c.updated_at >= ${filter.updatedFrom}::timestamptz`);
    if (filter.updatedTo) where.push(Prisma.sql`c.updated_at <= ${filter.updatedTo}::timestamptz`);
    if (filter.q) {
      where.push(
        Prisma.sql`(c.title ILIKE ${'%' + filter.q + '%'} OR c.slug::text ILIKE ${'%' + filter.q + '%'})`,
      );
    }
    // Hàng chờ xếp cũ trước: ai gửi sớm được xem trước.
    const oldestFirst = filter.pendingOnly === true;
    if (filter.cursor) {
      where.push(
        oldestFirst
          ? Prisma.sql`(c.updated_at, c.id) > (${filter.cursor.updatedAt}::timestamptz, ${filter.cursor.id}::uuid)`
          : Prisma.sql`(c.updated_at, c.id) < (${filter.cursor.updatedAt}::timestamptz, ${filter.cursor.id}::uuid)`,
      );
    }
    const clause = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const order = oldestFirst
      ? Prisma.sql`ORDER BY c.updated_at ASC, c.id ASC`
      : Prisma.sql`ORDER BY c.updated_at DESC, c.id DESC`;

    return this.prisma.$queryRaw<CourseListItem[]>`
      SELECT c.id, c.slug::text AS slug, c.title, c.level::text AS level, c.status::text AS status,
             c.duration_hours AS "durationHours", c.total_chapters AS "totalChapters",
             c.total_lessons AS "totalLessons", c.created_by AS "createdBy",
             u.display_name AS "authorName", c.updated_at AS "updatedAt"
      FROM courses c
      LEFT JOIN users u ON u.id = c.created_by
      ${clause}
      ${order}
      LIMIT ${filter.limit + 1}`;
  }

  async authorNameOf(userId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ displayName: string | null }[]>`
      SELECT display_name AS "displayName" FROM users WHERE id = ${userId}::uuid`;
    return rows[0]?.displayName ?? null;
  }

  async findCurriculum(courseId: string): Promise<StoredChapter[]> {
    const chapters = await this.prisma.$queryRaw<ChapterRow[]>`
      SELECT id, title, description, is_optional, position
      FROM chapters WHERE course_id = ${courseId}::uuid ORDER BY position`;

    // Bài code nằm ở exercise-service, nhưng cùng một PostgreSQL và studio cần tên bài
    // để hiển thị. Đây là ĐỌC, không ghi — ranh giới §5 cấm ghi chéo, không cấm join đọc.
    const lessons = await this.prisma.$queryRaw<LessonRow[]>`
      SELECT l.chapter_id AS "chapterId", l.id, l.title, l.type::text AS type,
             l.duration_minutes AS "durationMinutes", l.is_preview AS "isPreview",
             l.is_optional AS "isOptional", l.position, l.exercise_id AS "exerciseId",
             l.content_ref AS "contentRef",
             e.title AS "exerciseTitle", e.status::text AS "exerciseStatus",
             e.author_id AS "exerciseAuthorId"
      FROM lessons l
      LEFT JOIN exercises e ON e.id = l.exercise_id
      WHERE l.course_id = ${courseId}::uuid
      ORDER BY l.position`;

    return chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      isOptional: chapter.is_optional,
      position: chapter.position,
      lessons: lessons
        .filter((lesson) => lesson.chapterId === chapter.id)
        .map(({ chapterId: _chapterId, ...lesson }) => lesson),
    }));
  }

  /**
   * So khớp cây mới với cây cũ rồi ghi trong một transaction.
   *
   * Hai điểm không được bỏ:
   *
   * 1. `SET CONSTRAINTS ... DEFERRED`. Hai ràng buộc `UNIQUE(..., position)` khai
   *    DEFERRABLE nhưng INITIALLY IMMEDIATE, nghĩa là mặc định vẫn kiểm ngay từng lệnh.
   *    Hoán vị hai bài sẽ vỡ ở lệnh UPDATE đầu tiên nếu không hoãn tới cuối transaction.
   *
   * 2. Xoá trước, ghi sau. Một bài chuyển từ chương A sang chương B mà chương A bị xoá
   *    thì phải xoá A sau khi bài đã dời đi, nếu không CASCADE kéo bài đi theo.
   */
  async saveCurriculum(courseId: string, chapters: ChapterDraft[]): Promise<void> {
    const keptChapterIds = chapters.map((chapter) => chapter.id).filter((id): id is string => !!id);
    const keptLessonIds = chapters
      .flatMap((chapter) => chapter.lessons.map((lesson) => lesson.id))
      .filter((id): id is string => !!id);

    const statements: Prisma.PrismaPromise<unknown>[] = [
      this.prisma
        .$executeRaw`SET CONSTRAINTS chapters_position_unique, lessons_position_unique DEFERRED`,

      // Bài bị bỏ khỏi cây. `lesson_progress` CASCADE theo — đó là ý muốn của tác giả
      // khi họ xoá bài, nhưng chỉ đúng với bài họ thực sự xoá.
      keptLessonIds.length > 0
        ? this.prisma.$executeRaw`
            DELETE FROM lessons
            WHERE course_id = ${courseId}::uuid AND id <> ALL(${keptLessonIds}::uuid[])`
        : this.prisma.$executeRaw`DELETE FROM lessons WHERE course_id = ${courseId}::uuid`,

      keptChapterIds.length > 0
        ? this.prisma.$executeRaw`
            DELETE FROM chapters
            WHERE course_id = ${courseId}::uuid AND id <> ALL(${keptChapterIds}::uuid[])`
        : this.prisma.$executeRaw`DELETE FROM chapters WHERE course_id = ${courseId}::uuid`,
    ];

    for (const [chapterIndex, chapter] of chapters.entries()) {
      const chapterId = chapter.id ?? randomUUID();
      statements.push(this.prisma.$executeRaw`
        INSERT INTO chapters (id, course_id, title, description, position, is_optional)
        VALUES (${chapterId}::uuid, ${courseId}::uuid, ${chapter.title}, ${chapter.description},
                ${chapterIndex + 1}, ${chapter.isOptional})
        ON CONFLICT (id) DO UPDATE SET
          title       = EXCLUDED.title,
          description = EXCLUDED.description,
          position    = EXCLUDED.position,
          is_optional = EXCLUDED.is_optional,
          updated_at  = now()`);

      for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
        const lessonId = lesson.id ?? randomUUID();
        statements.push(this.prisma.$executeRaw`
          INSERT INTO lessons (id, chapter_id, course_id, title, type, duration_minutes,
                               is_preview, is_optional, position, exercise_id)
          VALUES (${lessonId}::uuid, ${chapterId}::uuid, ${courseId}::uuid, ${lesson.title},
                  ${lesson.type}::lesson_type, ${lesson.durationMinutes}, ${lesson.isPreview},
                  ${lesson.isOptional}, ${lessonIndex + 1}, ${lesson.exerciseId}::uuid)
          ON CONFLICT (id) DO UPDATE SET
            chapter_id       = EXCLUDED.chapter_id,
            title            = EXCLUDED.title,
            type             = EXCLUDED.type,
            duration_minutes = EXCLUDED.duration_minutes,
            is_preview       = EXCLUDED.is_preview,
            is_optional      = EXCLUDED.is_optional,
            position         = EXCLUDED.position,
            exercise_id      = EXCLUDED.exercise_id,
            updated_at       = now()`);
      }
    }

    try {
      await this.prisma.$transaction(statements);
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
  }

  async setLessonContentRef(lessonId: string, contentRef: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE lessons SET content_ref = ${contentRef}, updated_at = now()
      WHERE id = ${lessonId}::uuid`;
  }

  async save(course: Course): Promise<void> {
    try {
      // total_chapters và total_lessons CỐ Ý vắng mặt: trigger giữ chúng.
      await this.prisma.$executeRaw`
        INSERT INTO courses (id, slug, title, description, cover_image_url, level, duration_hours,
                             instructor_id, prerequisite_note, progression_mode, status,
                             created_by, rejection_reason, published_at)
        VALUES (${course.id}::uuid, ${course.slug}::citext, ${course.title}, ${course.description},
                ${course.coverImageUrl}, ${course.level}::current_level, ${course.durationHours},
                ${course.instructorId}::uuid, ${course.prerequisiteNote},
                ${course.progressionMode}::progression_mode, ${course.status}::content_status,
                ${course.createdBy}::uuid, ${course.rejectionReason}, ${course.publishedAt})
        ON CONFLICT (id) DO UPDATE SET
          slug              = EXCLUDED.slug,
          title             = EXCLUDED.title,
          description       = EXCLUDED.description,
          cover_image_url   = EXCLUDED.cover_image_url,
          level             = EXCLUDED.level,
          duration_hours    = EXCLUDED.duration_hours,
          instructor_id     = EXCLUDED.instructor_id,
          prerequisite_note = EXCLUDED.prerequisite_note,
          progression_mode  = EXCLUDED.progression_mode,
          status            = EXCLUDED.status,
          rejection_reason  = EXCLUDED.rejection_reason,
          published_at      = EXCLUDED.published_at,
          updated_at        = now()`;
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`DELETE FROM courses WHERE id = ${id}::uuid`;
    } catch (error) {
      throw mapDatabaseError(error, { onDelete: true, resource: 'Khóa học' }) ?? error;
    }
  }

  private toDomain(row: CourseRow): Course {
    return Course.rehydrate(row.id, {
      slug: row.slug,
      title: row.title,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      level: row.level as CurrentLevel,
      durationHours: row.duration_hours,
      instructorId: row.instructor_id,
      prerequisiteNote: row.prerequisite_note,
      progressionMode: row.progression_mode as ProgressionMode,
      status: row.status as ContentStatus,
      createdBy: row.created_by,
      rejectionReason: row.rejection_reason,
      publishedAt: row.published_at,
      totalChapters: row.total_chapters,
      totalLessons: row.total_lessons,
      updatedAt: row.updated_at,
    });
  }
}
