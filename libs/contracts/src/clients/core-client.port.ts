/**
 * Hợp đồng HTTP sang core-service. Service khác inject interface này thay vì gọi axios thẳng,
 * nhờ đó đổi transport (HTTP -> gRPC) hoặc mock trong test không phải sửa business logic.
 */
export interface UserSummary {
  id: string;
  displayName: string;
  email: string;
  role: 'learner' | 'admin';
}

export interface CoreClient {
  getUserSummary(userId: string): Promise<UserSummary | null>;
  getUserSummaries(userIds: string[]): Promise<UserSummary[]>;
}

export const CORE_CLIENT = Symbol('CORE_CLIENT');
