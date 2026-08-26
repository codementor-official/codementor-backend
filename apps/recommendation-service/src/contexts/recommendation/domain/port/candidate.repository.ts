import type { Candidate, LearnerPreferences } from '../model/scoring';

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
}

export const CANDIDATE_REPOSITORY = Symbol('CANDIDATE_REPOSITORY');
