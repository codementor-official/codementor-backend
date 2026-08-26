import { Injectable } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import type { CandidateRepository, TagAffinityRow } from '../domain/port/candidate.repository';
import type { Candidate, LearnerPreferences } from '../domain/model/scoring';

interface CandidateRow {
  id: string;
  slug: string;
  title: string;
  field: string | null;
  level: string | null;
  difficulty: string | null;
  technologies: string[] | null;
  tags?: string[] | null;
  popularityRaw: number | null;
}

interface PreferencesRow {
  currentLevel: string | null;
  careerGoal: string | null;
  contentPriority: string | null;
  interestedFields: string[] | null;
  interestedTechnologies: string[] | null;
  adaptiveRecommendations: boolean;
  completed: boolean;
}

/**
 * Trần ứng viên mỗi lần truy vấn. Chấm điểm chạy trong bộ nhớ nên phải có trần; 200 là
 * thừa sức cho catalog cỡ khóa luận mà vẫn là một truy vấn có index, không phải quét bảng.
 *
 * ponytail: khi catalog vượt quá con số này, cắt trước bằng lĩnh vực/trình độ trong SQL
 * (chỉ lấy ứng viên có `field` nằm trong `interested_fields`) rồi mới chấm điểm phần còn lại.
 */
const CANDIDATE_LIMIT = 200;

/*
 * Trần phải đi kèm thứ tự — mỗi truy vấn bên dưới có `ORDER BY "popularityRaw" DESC, id`
 * ngay trước `LIMIT`. Không có nó, Postgres cắt 200 dòng TÙY Ý: catalog vượt trần thì mỗi
 * lần gọi lấy một tập ứng viên khác nhau và đề xuất nhảy loạn không lý do. Lấy phần phổ
 * biến nhất — cũng là phần nhiều khả năng trụ lại sau khi chấm điểm. `id` là chốt cuối để
 * hai ứng viên cùng độ phổ biến (rất thường gặp: cả hai bằng 0) vẫn ra cùng thứ tự.
 */

function toCandidate(row: CandidateRow, kind: Candidate['kind']): Candidate {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind,
    field: row.field,
    level: row.level,
    difficulty: row.difficulty,
    technologies: row.technologies ?? [],
    tags: row.tags ?? [],
    popularityRaw: row.popularityRaw ?? 0,
  };
}

/**
 * MỌI truy vấn ở đây là SELECT.
 *
 * Service này không sở hữu bảng nào — nó đọc `learning_preferences` (core-service),
 * `roadmaps`/`courses`/enrollment (learning-service), `exercises`/`exercise_progress`
 * (exercise-service). `docs/02-service-architecture.md §5.2` muốn đường đọc chéo đi qua
 * view chỉ-đọc; ở đây đọc thẳng bảng, cùng lối đã có sẵn trong
 * `learning-service/.../user-activity.usecases.ts`.
 *
 * ponytail: khi codementor-infra thêm view `v_recommendable_*`, chỉ đổi tên bảng trong
 * file này — cổng, use case và controller không đổi một dòng.
 */
@Injectable()
export class PrismaCandidateRepository implements CandidateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPreferences(userId: string): Promise<LearnerPreferences | null> {
    const [row] = await this.prisma.$queryRaw<PreferencesRow[]>`
      SELECT current_level::text          AS "currentLevel",
             career_goal                  AS "careerGoal",
             content_priority::text       AS "contentPriority",
             interested_fields::text[]    AS "interestedFields",
             interested_technologies      AS "interestedTechnologies",
             adaptive_recommendations     AS "adaptiveRecommendations",
             (completed_at IS NOT NULL)   AS completed
      FROM learning_preferences
      WHERE user_id = ${userId}::uuid`;

    if (!row) return null;
    return {
      currentLevel: row.currentLevel,
      careerGoal: row.careerGoal,
      contentPriority: row.contentPriority,
      interestedFields: row.interestedFields ?? [],
      interestedTechnologies: row.interestedTechnologies ?? [],
      adaptiveRecommendations: row.adaptiveRecommendations,
      completed: row.completed,
    };
  }

  async listRoadmaps(userId: string, excludeSeen: boolean): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT r.id::text AS id, r.slug, r.title,
             r.field::text AS field, r.level::text AS level, NULL::text AS difficulty,
             -- popularity_score hiện không có gì nuôi (không trigger, không service nào ghi),
             -- nên lấy số người ghi danh làm nền: cột kia chỉ còn tác dụng khi ai đó set tay.
             GREATEST(r.popularity_score, count(DISTINCT re.id)::int) AS "popularityRaw",
             COALESCE(array_agg(DISTINCT t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS technologies
      FROM roadmaps r
      LEFT JOIN roadmap_technologies rt ON rt.roadmap_id = r.id
      LEFT JOIN technologies t ON t.id = rt.technology_id
      LEFT JOIN roadmap_enrollments re ON re.roadmap_id = r.id
      WHERE r.status = 'published'
        AND (NOT ${excludeSeen}::boolean OR NOT EXISTS (
          SELECT 1 FROM roadmap_enrollments mine
          WHERE mine.roadmap_id = r.id AND mine.user_id = ${userId}::uuid))
      GROUP BY r.id
      ORDER BY "popularityRaw" DESC, r.id
      LIMIT ${CANDIDATE_LIMIT}`;

    return rows.map((row) => toCandidate(row, 'roadmap'));
  }

  async listCourses(userId: string, excludeSeen: boolean): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT c.id::text AS id, c.slug, c.title,
             -- Bảng courses không có cột field; lĩnh vực suy từ lộ trình đầu tiên chứa khóa
             -- này. Khóa không nằm trong lộ trình nào thì không có lĩnh vực để khớp.
             (SELECT rm.field::text
              FROM roadmap_courses rc JOIN roadmaps rm ON rm.id = rc.roadmap_id
              WHERE rc.course_id = c.id AND rm.status = 'published'
              ORDER BY rc.position LIMIT 1) AS field,
             c.level::text AS level, NULL::text AS difficulty,
             c.enrollment_count AS "popularityRaw",
             COALESCE(array_agg(DISTINCT t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS technologies
      FROM courses c
      LEFT JOIN course_technologies ct ON ct.course_id = c.id
      LEFT JOIN technologies t ON t.id = ct.technology_id
      WHERE c.status = 'published'
        AND (NOT ${excludeSeen}::boolean OR NOT EXISTS (
          SELECT 1 FROM course_enrollments mine
          WHERE mine.course_id = c.id AND mine.user_id = ${userId}::uuid))
      GROUP BY c.id
      ORDER BY "popularityRaw" DESC, c.id
      LIMIT ${CANDIDATE_LIMIT}`;

    return rows.map((row) => toCandidate(row, 'course'));
  }

  async listExercises(userId: string, excludeSeen: boolean): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT e.id::text AS id, e.slug, e.title,
             NULL::text AS field, NULL::text AS level, e.difficulty::text AS difficulty,
             e.solver_count AS "popularityRaw",
             COALESCE(array_agg(DISTINCT t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS technologies,
             COALESCE(array_agg(DISTINCT tg.name) FILTER (WHERE tg.name IS NOT NULL), '{}') AS tags
      FROM exercises e
      LEFT JOIN exercise_technologies et ON et.exercise_id = e.id
      LEFT JOIN technologies t ON t.id = et.technology_id
      LEFT JOIN exercise_tags ext ON ext.exercise_id = e.id
      LEFT JOIN tags tg ON tg.id = ext.tag_id
      WHERE e.status = 'published' AND e.visibility = 'public'
        AND (NOT ${excludeSeen}::boolean OR NOT EXISTS (
          SELECT 1 FROM exercise_progress mine
          WHERE mine.exercise_id = e.id AND mine.user_id = ${userId}::uuid
            AND mine.status = 'solved'))
      GROUP BY e.id
      ORDER BY "popularityRaw" DESC, e.id
      LIMIT ${CANDIDATE_LIMIT}`;

    return rows.map((row) => toCandidate(row, 'exercise'));
  }

  /**
   * Chủ đề đọc từ trạng thái mới nhất (`exercise_progress`), không từ chuỗi `submissions`:
   * ở đây chỉ cần biết học viên đã qua hay còn mắc, không cần biết họ mắc từ lần thử nào.
   */
  async findTagAffinity(userId: string): Promise<TagAffinityRow[]> {
    return this.prisma.$queryRaw<TagAffinityRow[]>`
      SELECT tg.name AS tag,
             count(*) FILTER (WHERE ep.status = 'solved')::int    AS solved,
             count(*) FILTER (WHERE ep.status = 'attempted')::int AS attempted
      FROM exercise_progress ep
      JOIN exercise_tags ext ON ext.exercise_id = ep.exercise_id
      JOIN tags tg ON tg.id = ext.tag_id
      WHERE ep.user_id = ${userId}::uuid
      GROUP BY tg.name`;
  }

  async findExerciseTags(exerciseId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ tag: string }[]>`
      SELECT tg.name AS tag
      FROM exercise_tags ext
      JOIN tags tg ON tg.id = ext.tag_id
      WHERE ext.exercise_id = ${exerciseId}::uuid`;
    return rows.map((row) => row.tag);
  }
}
