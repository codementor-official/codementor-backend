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
 * Trần phải đi kèm THỨ TỰ — mỗi truy vấn bên dưới sắp `"popularityRaw" DESC, id` ngay
 * trước `LIMIT`. Không có nó, Postgres cắt 200 dòng tuỳ ý: catalog vượt trần thì mỗi lần
 * gọi lấy một tập ứng viên khác nhau và đề xuất nhảy loạn không lý do. `id` là chốt cuối
 * vì rất nhiều dòng cùng độ phổ biến bằng 0 — một mình popularity không phải thứ tự toàn phần.
 *
 * ponytail: khi catalog vượt quá con số này, cắt trước bằng lĩnh vực/trình độ trong SQL
 * (chỉ lấy ứng viên có `field` nằm trong `interested_fields`) rồi mới chấm điểm phần còn lại.
 */
const CANDIDATE_LIMIT = 200;

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
 * Service này không sở hữu bảng nào — nó đọc `learning_preferences`/`user_bookmarks`
 * (core-service), `roadmaps`/`courses`/`articles`/enrollment (learning-service),
 * `exercises`/`exercise_progress` (exercise-service), `study_groups`/`group_members`
 * (workspace-service). `docs/02-service-architecture.md §5.2` muốn đường đọc chéo đi qua
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
             COALESCE(array_agg(DISTINCT t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS technologies,
             -- Chủ đề của lộ trình = tác giả tự gắn HỢP với chủ đề của các khóa bên trong.
             -- Gom lúc đọc chứ không lưu: thêm một khóa vào lộ trình là chủ đề đổi theo, và
             -- một bản sao đã lưu thì lệch ngay từ lần sửa chương trình học đầu tiên.
             COALESCE(
               (SELECT array_agg(DISTINCT tg.name)
                FROM tags tg
                WHERE tg.id IN (
                  SELECT rt.tag_id FROM roadmap_tags rt WHERE rt.roadmap_id = r.id
                  UNION
                  SELECT ct.tag_id FROM roadmap_courses rc
                    JOIN course_tags ct ON ct.course_id = rc.course_id
                  WHERE rc.roadmap_id = r.id)),
               '{}') AS tags
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
             COALESCE(array_agg(DISTINCT t.slug) FILTER (WHERE t.slug IS NOT NULL), '{}') AS technologies,
             -- Chủ đề của khóa = tác giả tự gắn HỢP với chủ đề của bài tập trong các bài học.
             COALESCE(
               (SELECT array_agg(DISTINCT tg.name)
                FROM tags tg
                WHERE tg.id IN (
                  SELECT ct.tag_id FROM course_tags ct WHERE ct.course_id = c.id
                  UNION
                  SELECT ext.tag_id FROM lessons l
                    JOIN exercise_tags ext ON ext.exercise_id = l.exercise_id
                  WHERE l.course_id = c.id)),
               '{}') AS tags
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
   * Bài viết đã công khai.
   *
   * Không có `article_technologies` nên `technologies` luôn rỗng — việc khớp công nghệ dồn
   * hết vào `titleTechMatch` (đoán từ tiêu đề, ăn nửa trọng số). Chủ đề thì có thật:
   * `articles.tag_id` trỏ vào ĐÚNG bảng `tags` mà `exercise_tags` dùng, nên chủ đề học
   * viên còn dở dang ở phần luyện tập kéo được bài viết cùng chủ đề lên.
   *
   * Không có bảng nào đếm lượt đọc; số lượt lưu (`user_bookmarks`) là tín hiệu phổ biến
   * duy nhất, và cũng là thứ duy nhất nói được "học viên đã gặp bài này rồi".
   */
  async listArticles(userId: string, excludeSeen: boolean): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT a.id::text AS id, a.slug::text AS slug, a.title,
             NULL::text AS field, NULL::text AS level, NULL::text AS difficulty,
             (SELECT count(*)::int FROM user_bookmarks b
              WHERE b.target_type = 'POST' AND b.target_id = a.id) AS "popularityRaw",
             '{}'::text[] AS technologies,
             COALESCE(array_agg(t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
      FROM articles a
      LEFT JOIN tags t ON t.id = a.tag_id
      WHERE a.status = 'published'
        AND (NOT ${excludeSeen}::boolean OR NOT EXISTS (
          SELECT 1 FROM user_bookmarks mine
          WHERE mine.target_type = 'POST' AND mine.target_id = a.id
            AND mine.user_id = ${userId}::uuid))
      GROUP BY a.id
      -- Bài mới nhất thắng khi cùng số lượt lưu: phần lớn bài viết có 0 lượt, để mỗi id
      -- chốt thứ tự thì trang đề xuất đứng im ở đúng những bài cũ nhất.
      ORDER BY "popularityRaw" DESC, a.published_at DESC NULLS LAST, a.id
      LIMIT ${CANDIDATE_LIMIT}`;

    return rows.map((row) => toCandidate(row, 'article'));
  }

  /**
   * Nhóm học tập công khai còn hoạt động.
   *
   * Nhóm riêng tư không bao giờ ra khỏi đây: nó chỉ vào được bằng lời mời hoặc mã mời, nên
   * đề xuất một nhóm như vậy là vừa lộ sự tồn tại của nó vừa dẫn tới một cánh cửa khoá.
   *
   * `topic` là chữ tự do người tạo nhóm tự gõ, không phải khoá ngoại sang `tags` — đổ vào
   * `tags` để nó có cơ hội khớp với chủ đề học viên đang luyện, và chấp nhận rằng phần lớn
   * sẽ không khớp. `name` thường có tên công nghệ ("CLB React"), phần đó `titleTechMatch` lo.
   */
  async listGroups(userId: string, excludeSeen: boolean): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT g.id::text AS id, g.slug::text AS slug, g.name AS title,
             NULL::text AS field, NULL::text AS level, NULL::text AS difficulty,
             g.member_count AS "popularityRaw",
             '{}'::text[] AS technologies,
             COALESCE(array_remove(ARRAY[g.topic], NULL), '{}') AS tags
      FROM study_groups g
      WHERE g.status = 'active' AND g.privacy = 'public'
        AND (NOT ${excludeSeen}::boolean OR NOT EXISTS (
          SELECT 1 FROM group_members mine
          WHERE mine.group_id = g.id AND mine.user_id = ${userId}::uuid
            AND mine.status = 'active'))
      -- Nhóm vừa có người hoạt động thắng khi cùng số thành viên: nhóm đông mà im lìm là
      -- thứ tệ nhất để đẩy cho người mới.
      ORDER BY "popularityRaw" DESC, g.last_activity_at DESC NULLS LAST, g.id
      LIMIT ${CANDIDATE_LIMIT}`;

    return rows.map((row) => toCandidate(row, 'group'));
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

  /** Mảng chứ không phải một chuỗi: `articles.tag_id` là một chủ đề, nhưng phía gọi dùng
   *  chung `withJustSolved` với bài tập (nhiều chủ đề) nên trả về cùng một hình dạng. */
  async findArticleTags(articleId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ tag: string }[]>`
      SELECT t.name AS tag
      FROM articles a
      JOIN tags t ON t.id = a.tag_id
      WHERE a.id = ${articleId}::uuid`;
    return rows.map((row) => row.tag);
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
