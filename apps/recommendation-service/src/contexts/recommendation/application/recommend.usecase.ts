import { Inject, Injectable } from '@nestjs/common';
import {
  CANDIDATE_REPOSITORY,
  type CandidateRepository,
} from '../domain/port/candidate.repository';
import {
  isPersonalized,
  rankCandidates,
  type Candidate,
  type ScoredItem,
  type TagAffinityMap,
  withJustSolved,
} from '../domain/model/scoring';

/** Đúng những gì thẻ đề xuất ngoài giao diện cần — không trả cả hàng CSDL ra ngoài. */
export interface RecommendedItem {
  id: string;
  slug: string;
  title: string;
  kind: ScoredItem['kind'];
  field: string | null;
  level: string | null;
  difficulty: string | null;
  technologies: string[];
  score: number;
  /** Đổ vào ô `note` của `EntityCard` bên frontend. */
  reasons: string[];
}

export interface RecommendationList {
  /**
   * `false` khi học viên tắt `adaptive_recommendations` hoặc chưa làm onboarding — danh
   * sách lúc đó là bảng phổ biến chung, không dùng gì trong hồ sơ cá nhân.
   */
  personalized: boolean;
  items: RecommendedItem[];
}

function toItem(scored: ScoredItem): RecommendedItem {
  return {
    id: scored.id,
    slug: scored.slug,
    title: scored.title,
    kind: scored.kind,
    field: scored.field,
    level: scored.level,
    difficulty: scored.difficulty,
    technologies: scored.technologies,
    score: scored.score,
    reasons: scored.reasons,
  };
}

@Injectable()
export class RecommendUseCase {
  constructor(
    @Inject(CANDIDATE_REPOSITORY)
    private readonly candidates: CandidateRepository,
  ) {}

  roadmaps(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(
      userId,
      limit,
      (id, excludeSeen) => this.candidates.listRoadmaps(id, excludeSeen),
      true,
    );
  }

  courses(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(
      userId,
      limit,
      (id, excludeSeen) => this.candidates.listCourses(id, excludeSeen),
      true,
    );
  }

  exercises(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(
      userId,
      limit,
      (id, excludeSeen) => this.candidates.listExercises(id, excludeSeen),
      true,
    );
  }

  /**
   * Gợi ý một bài kế tiếp ngay sau khi nộp đạt.
   *
   * Cùng luật xếp hạng, khác hai chỗ, cả hai vì `exercise_progress` chạy sau qua sự kiện
   * nên lúc này CHƯA biết bài vừa xong đã được giải: phải tự bỏ bài đó khỏi danh sách, và
   * phải tự cộng chủ đề của nó vào phần đã giải.
   */
  async nextExercise(userId: string, exerciseId: string): Promise<RecommendationList> {
    const [candidates, preferences, affinity, justSolvedTags] = await Promise.all([
      this.candidates.listExercises(userId, true),
      this.candidates.findPreferences(userId),
      this.tagAffinity(userId),
      this.candidates.findExerciseTags(exerciseId),
    ]);
    const pool = candidates.filter((c) => c.id !== exerciseId);
    return {
      personalized: isPersonalized(preferences),
      items: rankCandidates(pool, preferences, {
        affinity: withJustSolved(affinity, justSolvedTags),
      })
        .slice(0, 1)
        .map(toItem),
    };
  }

  /** Chủ đề học viên đã giải / còn mắc, đọc từ trạng thái đã lưu. */
  private async tagAffinity(userId: string): Promise<TagAffinityMap> {
    const rows = await this.candidates.findTagAffinity(userId);
    return new Map(rows.map((row) => [row.tag, { solved: row.solved, attempted: row.attempted }]));
  }

  /**
   * Xếp hạng những gì học viên CHƯA đụng tới; nếu không còn gì thì xếp hạng lại cả danh
   * mục.
   *
   * Học viên ghi danh hết mọi khóa đã xuất bản là chuyện thường trên một catalog nhỏ, và
   * khi đó ô "đề xuất cho bạn" rỗng trơn — tệ hơn hẳn việc nhắc lại thứ họ đang học. Rơi
   * về danh mục đầy đủ giữ ô đó luôn có nội dung; lượt truy vấn thứ hai chỉ xảy ra đúng
   * lúc lượt đầu về tay không.
   */
  private async rank(
    userId: string,
    limit: number,
    load: (userId: string, excludeSeen: boolean) => Promise<Candidate[]>,
    /**
     * Đếm chủ đề học viên đã đụng tới. Cả ba loại đều dùng: lộ trình và khóa học không tự
     * gắn đủ chủ đề, nhưng gom được chủ đề của thứ nằm bên trong chúng.
     */
    withAffinity = false,
  ): Promise<RecommendationList> {
    const [fresh, preferences, affinity] = await Promise.all([
      load(userId, true),
      this.candidates.findPreferences(userId),
      withAffinity ? this.tagAffinity(userId) : Promise.resolve<TagAffinityMap>(new Map()),
    ]);
    const pool = fresh.length > 0 ? fresh : await load(userId, false);
    return {
      personalized: isPersonalized(preferences),
      items: rankCandidates(pool, preferences, { affinity }).slice(0, limit).map(toItem),
    };
  }
}
