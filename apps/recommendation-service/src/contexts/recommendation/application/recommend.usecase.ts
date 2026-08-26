import { Inject, Injectable } from '@nestjs/common';
import {
  CANDIDATE_REPOSITORY,
  type CandidateRepository,
} from '../domain/port/candidate.repository';
import { isPersonalized, rankCandidates, type Candidate, type ScoredItem } from '../domain/model/scoring';

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
    return this.rank(userId, limit, (id, excludeSeen) =>
      this.candidates.listRoadmaps(id, excludeSeen),
    );
  }

  courses(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(userId, limit, (id, excludeSeen) =>
      this.candidates.listCourses(id, excludeSeen),
    );
  }

  exercises(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(userId, limit, (id, excludeSeen) =>
      this.candidates.listExercises(id, excludeSeen),
    );
  }

  /**
   * Gợi ý một bài kế tiếp ngay sau khi nộp đạt. Cùng danh sách ứng viên và cùng luật xếp
   * hạng, chỉ khác là bỏ chính bài vừa làm ra — bài đó chưa kịp có `exercise_progress`
   * ở trạng thái `solved` lúc hộp thoại chúc mừng hiện lên, nên bộ lọc chung chưa loại nó.
   */
  async nextExercise(userId: string, exerciseId: string): Promise<RecommendationList> {
    const pool = (await this.candidates.listExercises(userId, true)).filter(
      (c) => c.id !== exerciseId,
    );
    const preferences = await this.candidates.findPreferences(userId);
    return {
      personalized: isPersonalized(preferences),
      items: rankCandidates(pool, preferences).slice(0, 1).map(toItem),
    };
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
  ): Promise<RecommendationList> {
    const [fresh, preferences] = await Promise.all([
      load(userId, true),
      this.candidates.findPreferences(userId),
    ]);
    const pool = fresh.length > 0 ? fresh : await load(userId, false);
    return {
      personalized: isPersonalized(preferences),
      items: rankCandidates(pool, preferences).slice(0, limit).map(toItem),
    };
  }
}
