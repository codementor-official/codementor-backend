import type { Candidate, LearnerPreferences } from '../model/scoring';

/** Một chủ đề học viên đã đụng tới, đếm trên `exercise_progress`. */
export interface TagAffinityRow {
  tag: string;
  solved: number;
  attempted: number;
}

/**
 * Nguồn ứng viên để chấm điểm. Là một cổng riêng chứ không gọi Prisma thẳng trong use case
 * vì đây là chỗ DUY NHẤT chạm vào bảng của service khác — đổi sang đọc qua view hay qua
 * HTTP sau này chỉ phải sửa một file.
 */
export interface CandidateRepository {
  /** `null` khi học viên chưa từng lưu hồ sơ cá nhân hóa. */
  findPreferences(userId: string): Promise<LearnerPreferences | null>;
  /**
   * `excludeSeen` bỏ đi những thứ học viên đã ghi danh / đã giải. Đặt `false` để lấy cả
   * danh mục — dùng khi lọc xong không còn gì (xem `RecommendUseCase.rank`).
   */
  listRoadmaps(userId: string, excludeSeen: boolean): Promise<Candidate[]>;
  listCourses(userId: string, excludeSeen: boolean): Promise<Candidate[]>;
  listExercises(userId: string, excludeSeen: boolean): Promise<Candidate[]>;
  /**
   * Bài viết đã công khai. `excludeSeen` bỏ bài học viên đã lưu — không có bảng nào ghi
   * lượt ĐỌC, nên lưu là dấu vết duy nhất chứng tỏ họ đã gặp bài đó.
   */
  listArticles(userId: string, excludeSeen: boolean): Promise<Candidate[]>;
  /** Nhóm công khai còn hoạt động. `excludeSeen` bỏ nhóm học viên đang là thành viên. */
  listGroups(userId: string, excludeSeen: boolean): Promise<Candidate[]>;
  /**
   * Chủ đề học viên đã giải / đã thử mà chưa giải được. Rỗng với người chưa làm bài nào,
   * và với mọi bài chưa được gắn chủ đề.
   */
  findTagAffinity(userId: string): Promise<TagAffinityRow[]>;
  /** Chủ đề của MỘT bài, theo tên. Dùng cho bài vừa nộp đạt, xem `withJustSolved`. */
  findExerciseTags(exerciseId: string): Promise<string[]>;
  /** Chủ đề của MỘT bài viết. Dùng cho bài đang đọc, xem `RecommendUseCase.relatedArticles`. */
  findArticleTags(articleId: string): Promise<string[]>;
}

export const CANDIDATE_REPOSITORY = Symbol('CANDIDATE_REPOSITORY');
