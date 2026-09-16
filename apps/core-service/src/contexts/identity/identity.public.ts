/**
 * HỢP ĐỒNG DUY NHẤT mà context khác được import từ Identity.
 *
 * Không export aggregate, repository hay value object — chỉ dữ liệu phẳng và cổng truy vấn.
 * Khi tách microservice, chỉ cần thay implementation của `IdentityQuery` bằng HTTP client;
 * context gọi tới không phải sửa gì.
 */
export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: 'learner' | 'lecturer' | 'admin';
}

export interface IdentityQuery {
  /** Trả về null nếu không tồn tại hoặc đã bị xoá mềm. */
  getUserSummary(userId: string): Promise<UserSummary | null>;
  getUserSummaries(userIds: string[]): Promise<UserSummary[]>;
}

export const IDENTITY_QUERY = Symbol('IDENTITY_QUERY');
