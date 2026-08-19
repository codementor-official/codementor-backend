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
} from '../domain/port/exercise.repository';

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
      SELECT id, slug, title, summary, kind::text, difficulty::text, status::text,
             visibility::text, xp_reward, estimated_minutes, time_limit_ms, memory_limit_kb,
             author_id, content_ref, forked_from_id, rejection_reason, published_at, updated_at
      FROM exercises WHERE id = ${id}::uuid LIMIT 1`;
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
    if (filter.status) where.push(Prisma.sql`e.status = ${filter.status}::exercise_status`);
    if (filter.updatedFrom) where.push(Prisma.sql`e.updated_at >= ${filter.updatedFrom}::timestamptz`);
    if (filter.updatedTo) where.push(Prisma.sql`e.updated_at <= ${filter.updatedTo}::timestamptz`);
    if (filter.q) {
      // citext ở slug nhưng title là text, nên vẫn cần ILIKE.
      where.push(Prisma.sql`(e.title ILIKE ${'%' + filter.q + '%'} OR e.slug::text ILIKE ${'%' + filter.q + '%'})`);
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

    const clause = where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const order = oldestFirst
      ? Prisma.sql`ORDER BY e.updated_at ASC, e.id ASC`
      : Prisma.sql`ORDER BY e.updated_at DESC, e.id DESC`;

    return this.prisma.$queryRaw<ExerciseListItem[]>`
      SELECT e.id, e.slug::text AS slug, e.title, e.kind::text AS kind,
             e.difficulty::text AS difficulty, e.status::text AS status,
             e.visibility::text AS visibility,
             e.author_id AS "authorId", u.display_name AS "authorName",
             e.forked_from_id AS "forkedFromId", e.updated_at AS "updatedAt"
      FROM exercises e
      LEFT JOIN users u ON u.id = e.author_id
      ${clause}
      ${order}
      LIMIT ${filter.limit + 1}`;
  }

  async save(exercise: Exercise): Promise<void> {
    try {
      await this.prisma.$executeRaw`
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
          updated_at        = now()`;
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
      forkedFromId: row.forked_from_id,
      rejectionReason: row.rejection_reason,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    });
  }
}
