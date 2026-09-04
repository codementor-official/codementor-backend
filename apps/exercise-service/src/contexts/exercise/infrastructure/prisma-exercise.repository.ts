import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, mapDatabaseError } from '@codementor/platform';
import { Exercise } from '../domain/model/exercise';
import type {
  ExerciseDifficulty,
  ExerciseKind,
  ExerciseStatus,
  ExerciseVisibility,
} from '../domain/model/exercise';
import { Slug } from '../domain/model/slug';
import type {
  ExerciseListFilter,
  ExerciseListItem,
  ExerciseRepository,
  ExerciseProgressSummary,
  ExerciseTopicSummary,
} from '../domain/port/exercise.repository';

interface ExerciseListRow extends Omit<ExerciseListItem, 'topics'> {
  topics: Array<{ id: string; slug: string; name: string; category: string }> | null;
}

interface ExerciseRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  kind: string;
  difficulty: string;
  status: string;
  visibility: string;
  xp_reward: number;
  estimated_minutes: number | null;
  time_limit_ms: number;
  memory_limit_kb: number;
  author_id: string | null;
  content_ref: string | null;
  tag_ids: string[] | null;
  forked_from_id: string | null;
  rejection_reason: string | null;
  published_at: Date | null;
  updated_at: Date;
}

/** Chỉ context Exercise được đọc/ghi bảng `exercises`. */
@Injectable()
export class PrismaExerciseRepository implements ExerciseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Exercise | null> {
    const rows = await this.prisma.$queryRaw<ExerciseRow[]>`
      SELECT e.id, e.slug, e.title, e.summary, e.kind::text, e.difficulty::text, e.status::text,
             e.visibility::text, e.xp_reward, e.estimated_minutes, e.time_limit_ms,
             e.memory_limit_kb, e.author_id, e.content_ref, e.forked_from_id, e.rejection_reason,
             e.published_at, e.updated_at,
             COALESCE(
               (SELECT array_agg(et.tag_id::text ORDER BY et.tag_id)
                FROM exercise_tags et WHERE et.exercise_id = e.id),
               '{}') AS tag_ids
      FROM exercises e WHERE e.id = ${id}::uuid LIMIT 1`;
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async existsBySlug(slug: Slug): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM exercises WHERE slug = ${slug.value}::citext LIMIT 1`;
    return rows.length > 0;
  }

  /**
   * Sắp theo `(updated_at, id)` giảm dần và phân trang bằng cursor trên đúng cặp đó.
   * Lấy dư một hàng để biết còn trang sau mà không phải chạy thêm COUNT.
   */
  async list(filter: ExerciseListFilter): Promise<ExerciseListItem[]> {
    const where: Prisma.Sql[] = [];

    if (filter.authorId !== null) {
      where.push(Prisma.sql`e.author_id = ${filter.authorId}::uuid`);
    }
    if (filter.publishedOnly) {
      where.push(Prisma.sql`e.visibility = 'public' AND e.status = 'published'`);
    }
    if (filter.pendingOnly) where.push(Prisma.sql`e.status = 'pending_review'`);
    if (filter.excludeDraft && !filter.status) where.push(Prisma.sql`e.status <> 'draft'`);
    if (filter.kind) where.push(Prisma.sql`e.kind = ${filter.kind}::exercise_kind`);
    if (filter.difficulty) {
      where.push(Prisma.sql`e.difficulty = ${filter.difficulty}::exercise_difficulty`);
    }
    if (filter.topicIds?.length) {
      where.push(Prisma.sql`EXISTS (
        SELECT 1 FROM exercise_tags selected_topic
        WHERE selected_topic.exercise_id = e.id
          AND selected_topic.tag_id = ANY (${filter.topicIds}::uuid[])
      )`);
    }
    if (filter.progress === 'solved') {
      where.push(Prisma.sql`ep.status = 'solved'`);
    } else if (filter.progress === 'attempted') {
      where.push(Prisma.sql`ep.status = 'attempted'`);
    } else if (filter.progress === 'unsolved') {
      where.push(Prisma.sql`COALESCE(ep.status::text, 'todo') <> 'solved'`);
    }
    if (filter.status) where.push(Prisma.sql`e.status = ${filter.status}::exercise_status`);
    if (filter.updatedFrom)
      where.push(Prisma.sql`e.updated_at >= ${filter.updatedFrom}::timestamptz`);
    if (filter.updatedTo) where.push(Prisma.sql`e.updated_at <= ${filter.updatedTo}::timestamptz`);
    if (filter.q) {
      // citext ở slug nhưng title là text, nên vẫn cần ILIKE.
      const search = '%' + filter.q + '%';
      where.push(Prisma.sql`(
        e.title ILIKE ${search}
        OR e.slug::text ILIKE ${search}
        OR e.summary ILIKE ${search}
        OR u.display_name ILIKE ${search}
        OR EXISTS (
          SELECT 1 FROM exercise_tags search_topic
          JOIN tags search_tag ON search_tag.id = search_topic.tag_id
          WHERE search_topic.exercise_id = e.id AND search_tag.name ILIKE ${search}
        )
      )`);
    }
    // Hàng chờ duyệt xếp CŨ TRƯỚC: ai gửi sớm được xem trước, và bài chờ lâu nhất
    // không bị đẩy xuống cuối mỗi khi có người gửi bài mới.
    const oldestFirst = filter.pendingOnly === true;
    if (filter.cursor) {
      where.push(
        oldestFirst
          ? Prisma.sql`(e.updated_at, e.id) > (${filter.cursor.updatedAt}::timestamptz, ${filter.cursor.id}::uuid)`
          : Prisma.sql`(e.updated_at, e.id) < (${filter.cursor.updatedAt}::timestamptz, ${filter.cursor.id}::uuid)`,
      );
    }

    const clause =
      where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const order = oldestFirst
      ? Prisma.sql`ORDER BY e.updated_at ASC, e.id ASC`
      : Prisma.sql`ORDER BY e.updated_at DESC, e.id DESC`;

    const rows = await this.prisma.$queryRaw<ExerciseListRow[]>`
      SELECT e.id, e.slug::text AS slug, e.title, e.summary, e.kind::text AS kind,
             e.difficulty::text AS difficulty, e.status::text AS status,
             e.visibility::text AS visibility,
             e.author_id AS "authorId", u.display_name AS "authorName",
             COALESCE((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', topic.id,
                   'slug', topic.slug::text,
                   'name', topic.name,
                   'category', topic.category
                 )
                 ORDER BY topic.name
               )
               FROM exercise_tags listed_topic
               JOIN tags topic ON topic.id = listed_topic.tag_id
               WHERE listed_topic.exercise_id = e.id
             ), '[]'::jsonb) AS topics,
             COALESCE(ep.status::text, 'todo') AS "progressStatus",
             COALESCE(ep.attempt_count, 0)::int AS "attemptCount",
             ep.best_score AS "bestScore",
             (e.status = 'published' AND e.rejection_reason IS NOT NULL) AS "removalRequested",
             e.forked_from_id AS "forkedFromId", e.updated_at AS "updatedAt"
      FROM exercises e
      LEFT JOIN users u ON u.id = e.author_id
      LEFT JOIN exercise_progress ep
        ON ep.exercise_id = e.id AND ep.user_id = ${filter.viewerId ?? null}::uuid
      ${clause}
      ${order}
      LIMIT ${filter.limit + 1}`;
    return rows.map((row) => ({ ...row, topics: row.topics ?? [] }));
  }

  async listTopics(userId: string): Promise<ExerciseTopicSummary[]> {
    return this.prisma.$queryRaw<ExerciseTopicSummary[]>`
      SELECT t.id, t.slug::text AS slug, t.name, t.category,
             COUNT(DISTINCT e.id)::int AS count,
             COUNT(DISTINCT e.id) FILTER (WHERE ep.status = 'solved')::int AS solved,
             COUNT(DISTINCT e.id) FILTER (WHERE ep.status = 'attempted')::int AS attempted
      FROM tags t
      JOIN exercise_tags et ON et.tag_id = t.id
      JOIN exercises e ON e.id = et.exercise_id
      LEFT JOIN exercise_progress ep
        ON ep.exercise_id = e.id AND ep.user_id = ${userId}::uuid
      WHERE e.visibility = 'public' AND e.status = 'published'
      GROUP BY t.id, t.slug, t.name, t.category
      ORDER BY COUNT(DISTINCT e.id) DESC, t.name ASC`;
  }

  async progressSummary(userId: string): Promise<ExerciseProgressSummary> {
    const rows = await this.prisma.$queryRaw<ExerciseProgressSummary[]>`
      SELECT COUNT(DISTINCT e.id)::int AS total,
             COUNT(DISTINCT e.id) FILTER (WHERE ep.status = 'solved')::int AS solved,
             COUNT(DISTINCT e.id) FILTER (WHERE ep.status = 'attempted')::int AS attempted,
             COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(ep.status::text, 'todo') <> 'solved')::int AS unsolved
      FROM exercises e
      LEFT JOIN exercise_progress ep
        ON ep.exercise_id = e.id AND ep.user_id = ${userId}::uuid
      WHERE e.visibility = 'public' AND e.status = 'published'`;
    return rows[0] ?? { total: 0, solved: 0, attempted: 0, unsolved: 0 };
  }

  async save(exercise: Exercise): Promise<void> {
    try {
      // Một giao dịch: bài và chủ đề của nó phải cùng sống hoặc cùng chết. Lưu bài xong
      // mà chèn chủ đề hỏng thì bản ghi còn lại mang danh sách chủ đề của lần lưu TRƯỚC,
      // và không ai nhìn màn hình biết được điều đó.
      await this.prisma.$transaction([
        this.prisma.$executeRaw`
        INSERT INTO exercises (id, slug, title, summary, kind, difficulty, status, visibility,
                               xp_reward, estimated_minutes, time_limit_ms, memory_limit_kb,
                               author_id, content_ref, forked_from_id, rejection_reason, published_at)
        VALUES (${exercise.id}::uuid, ${exercise.slug.value}::citext, ${exercise.title},
                ${exercise.summary}, ${exercise.kind}::exercise_kind,
                ${exercise.difficulty}::exercise_difficulty, ${exercise.status}::exercise_status,
                ${exercise.visibility}::exercise_visibility, ${exercise.xpReward},
                ${exercise.estimatedMinutes}, ${exercise.timeLimitMs}, ${exercise.memoryLimitKb},
                ${exercise.authorId}::uuid, ${exercise.contentRef}, ${exercise.forkedFromId}::uuid,
                ${exercise.rejectionReason}, ${exercise.publishedAt})
        ON CONFLICT (id) DO UPDATE SET
          slug              = EXCLUDED.slug,
          title             = EXCLUDED.title,
          summary           = EXCLUDED.summary,
          difficulty        = EXCLUDED.difficulty,
          status            = EXCLUDED.status,
          visibility        = EXCLUDED.visibility,
          xp_reward         = EXCLUDED.xp_reward,
          estimated_minutes = EXCLUDED.estimated_minutes,
          time_limit_ms     = EXCLUDED.time_limit_ms,
          memory_limit_kb   = EXCLUDED.memory_limit_kb,
          content_ref       = EXCLUDED.content_ref,
          rejection_reason  = EXCLUDED.rejection_reason,
          published_at      = EXCLUDED.published_at,
          updated_at        = now()`,
        this.prisma.$executeRaw`
          DELETE FROM exercise_tags
          WHERE exercise_id = ${exercise.id}::uuid
            AND tag_id <> ALL (${exercise.tagIds}::uuid[])`,
        this.prisma.$executeRaw`
          INSERT INTO exercise_tags (exercise_id, tag_id)
          SELECT ${exercise.id}::uuid, tag_id
          FROM unnest(${exercise.tagIds}::uuid[]) AS tag_id
          ON CONFLICT DO NOTHING`,
      ]);
    } catch (error) {
      throw mapDatabaseError(error) ?? error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`DELETE FROM exercises WHERE id = ${id}::uuid`;
    } catch (error) {
      // `onDelete` là bắt buộc: 23503 ở chiều xoá nghĩa là "còn thứ khác đang dùng"
      // (409), không phải "trỏ tới thứ không tồn tại" (400).
      throw mapDatabaseError(error, { onDelete: true, resource: 'Bài tập' }) ?? error;
    }
  }

  async findReferencingCourses(
    exerciseId: string,
  ): Promise<{ id: string; title: string; slug: string }[]> {
    return this.prisma.$queryRaw<{ id: string; title: string; slug: string }[]>`
      SELECT DISTINCT c.id, c.title, c.slug::text AS slug
      FROM courses c
      JOIN lessons l ON l.course_id = c.id
      WHERE l.exercise_id = ${exerciseId}::uuid
    `;
  }

  private toDomain(row: ExerciseRow): Exercise {
    const slug = Slug.create(row.slug);
    if (slug.isFail) throw new Error(`Slug không hợp lệ trong CSDL cho exercise ${row.id}`);

    return Exercise.rehydrate(row.id, {
      slug: slug.value,
      title: row.title,
      summary: row.summary,
      kind: row.kind as ExerciseKind,
      difficulty: row.difficulty as ExerciseDifficulty,
      status: row.status as ExerciseStatus,
      visibility: row.visibility as ExerciseVisibility,
      xpReward: row.xp_reward,
      estimatedMinutes: row.estimated_minutes,
      timeLimitMs: row.time_limit_ms,
      memoryLimitKb: row.memory_limit_kb,
      authorId: row.author_id,
      contentRef: row.content_ref,
      tagIds: row.tag_ids ?? [],
      forkedFromId: row.forked_from_id,
      rejectionReason: row.rejection_reason,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    });
  }
}
