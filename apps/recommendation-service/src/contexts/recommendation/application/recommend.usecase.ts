import { Inject, Injectable } from '@nestjs/common';
import {
  CANDIDATE_REPOSITORY,
  type CandidateRepository,
} from '../domain/port/candidate.repository';
import {
  hasLearningHistory,
  isPersonalized,
  normalizePopularity,
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
  /**
   * Tên chủ đề. Chip trên thẻ bài viết và nhãn chủ đề trên thẻ nhóm đọc từ đây — hai loại
   * này không có `field`/`level` để hiện, chủ đề là thứ duy nhất mô tả được chúng.
   */
  tags: string[];
  score: number;
  /**
   * Độ phổ biến đã chuẩn hóa 0..100 trong chính tập ứng viên. Thẻ nhóm hiện nó thành thanh
   * "mức sôi động" — số thành viên thô không nói lên gì khi không biết nhóm khác bao nhiêu.
   */
  popularity: number;
  /** Đổ vào ô `note` của `EntityCard` bên frontend. */
  reasons: string[];
}

export interface RecommendationList {
  /**
   * `false` khi học viên tắt gợi ý hoặc chưa có hồ sơ/lịch sử dùng để cá nhân hóa.
   */
  personalized: boolean;
  items: RecommendedItem[];
}

/**
 * `rankCandidates` chuẩn hóa độ phổ biến trong nội bộ nó rồi vứt đi — chỉ giữ lại `score`
 * đã cộng. Tính lại trên CÙNG tập ứng viên (không phải trên top đã cắt) để con số ra ngoài
 * khớp với con số đã dùng lúc chấm điểm.
 */
function withPopularity(pool: Candidate[]): (scored: ScoredItem) => RecommendedItem {
  const popularity = normalizePopularity(pool);
  return (scored) => toItem(scored, Math.round(popularity.get(scored.id) ?? 0));
}

function toItem(scored: ScoredItem, popularity: number): RecommendedItem {
  return {
    id: scored.id,
    slug: scored.slug,
    title: scored.title,
    kind: scored.kind,
    field: scored.field,
    level: scored.level,
    difficulty: scored.difficulty,
    technologies: scored.technologies,
    tags: scored.tags,
    score: scored.score,
    popularity,
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
    return this.rank(userId, limit, (id, seen) => this.candidates.listRoadmaps(id, seen));
  }

  courses(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(userId, limit, (id, seen) => this.candidates.listCourses(id, seen));
  }

  exercises(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(userId, limit, (id, seen) => this.candidates.listExercises(id, seen));
  }

  articles(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(userId, limit, (id, seen) => this.candidates.listArticles(id, seen));
  }

  groups(userId: string, limit: number): Promise<RecommendationList> {
    return this.rank(userId, limit, (id, seen) => this.candidates.listGroups(id, seen), false);
  }

  /**
   * Gợi ý một bài kế tiếp ngay sau khi nộp đạt.
   *
   * Cùng luật xếp hạng, khác hai chỗ, cả hai vì `exercise_progress` chạy sau qua sự kiện
   * nên lúc này CHƯA biết bài vừa xong đã được giải: phải tự bỏ bài đó khỏi danh sách, và
   * phải tự cộng chủ đề của nó vào phần đã giải.
   */
  async nextExercise(userId: string, exerciseId: string): Promise<RecommendationList> {
    const [candidates, preferences] = await Promise.all([
      this.candidates.listExercises(userId, true),
      this.candidates.findPreferences(userId),
    ]);
    const [affinity, history, justSolvedTags] = preferences?.adaptiveRecommendations !== false
      ? await Promise.all([this.tagAffinity(userId), this.candidates.findHistoryProfile(userId), this.candidates.findExerciseTags(exerciseId)])
      : [new Map(), [], []];
    const pool = candidates.filter((c) => c.id !== exerciseId);
    const merged = withJustSolved(affinity, justSolvedTags);
    return {
      personalized: isPersonalized(preferences, hasLearningHistory(merged, history)),
      items: rankCandidates(pool, preferences, { affinity: merged, history })
        .slice(0, 1)
        .map(withPopularity(pool)),
    };
  }

  /**
   * Bài viết liên quan bài đang đọc.
   *
   * Cùng khuôn với `nextExercise`: bỏ chính bài đang mở khỏi danh sách, rồi cộng chủ đề
   * của nó vào bản đồ chủ đề trước khi chấm điểm.
   *
   * Nâng ĐIỂM chứ không LỌC theo chủ đề: mỗi bài viết chỉ mang một `tag_id`, nên lọc cứng
   * sẽ trả về danh sách rỗng ngay khi chủ đề đó chỉ có đúng bài đang đọc — chỗ "bài viết
   * liên quan" khi ấy biến mất thay vì đưa ra thứ gần nhất còn lại. Cộng điểm thì bài cùng
   * chủ đề luôn nổi lên trước, mà danh sách không bao giờ trống.
   */
  async relatedArticles(
    userId: string,
    articleId: string,
    limit: number,
  ): Promise<RecommendationList> {
    const [candidates, preferences] = await Promise.all([
      this.candidates.listArticles(userId, true),
      this.candidates.findPreferences(userId),
    ]);
    const [affinity, history, readingTags] = preferences?.adaptiveRecommendations !== false
      ? await Promise.all([this.tagAffinity(userId), this.candidates.findHistoryProfile(userId), this.candidates.findArticleTags(articleId)])
      : [new Map(), [], []];
    // Bài đang đọc chỉ bị `listArticles` loại khi học viên đã LƯU nó — lưu là dấu vết "đã
    // gặp" duy nhất, mà mở ra đọc thì không lưu gì cả.
    const drop = (list: Candidate[]) => list.filter((c) => c.id !== articleId);
    const pool = drop(candidates);
    // Lượt thứ hai cũng phải bỏ bài đang đọc: nó nằm trong danh mục đầy đủ, và đề xuất
    // "bài liên quan" là chính bài người ta đang mở thì vô nghĩa nhất.
    const fresh = pool.length > 0 ? pool : drop(await this.candidates.listArticles(userId, false));
    const merged = withJustSolved(affinity, readingTags);
    return {
      personalized: isPersonalized(preferences, hasLearningHistory(merged, history)),
      items: rankCandidates(fresh, preferences, { affinity: merged, history })
        .slice(0, limit)
        .map(withPopularity(fresh)),
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
    allowSeenFallback = true,
  ): Promise<RecommendationList> {
    // Cả ba loại đều chấm theo chủ đề: lộ trình và khóa học ít khi tự gắn đủ, nhưng gom
    // được chủ đề của thứ nằm bên trong chúng.
    const [fresh, preferences] = await Promise.all([
      load(userId, true),
      this.candidates.findPreferences(userId),
    ]);
    // Opt-out does not read personal exercise history for scoring. Membership/enrollment
    // exclusions still avoid suggesting an action the learner already performed.
    const [affinity, history] = preferences?.adaptiveRecommendations !== false
      ? await Promise.all([this.tagAffinity(userId), this.candidates.findHistoryProfile(userId)])
      : [new Map(), []];
    const pool = fresh.length > 0 || !allowSeenFallback ? fresh : await load(userId, false);
    return {
      personalized: isPersonalized(preferences, hasLearningHistory(affinity, history)),
      items: rankCandidates(pool, preferences, { affinity, history })
        .slice(0, limit)
        .map(withPopularity(pool)),
    };
  }
}
