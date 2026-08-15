import type { AuthenticatedUser, PlatformRole } from './jwt-payload';

export interface ProvisionUserInput {
  externalId: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  role: PlatformRole;
  /**
   * Bản gốc của access token. core-service không cần — nó đọc thẳng bảng `users`.
   * Service khác thì cần để hỏi core bằng chính danh tính của người gọi.
   */
  accessToken?: string;
}

/**
 * Cổng để tầng auth (hạ tầng dùng chung) nhờ context Identity tạo/đồng bộ hồ sơ nội bộ.
 *
 * Khai báo ở `shared/auth` và hiện thực trong `contexts/identity` để tránh phụ thuộc
 * ngược: hạ tầng không được biết chi tiết bên trong context nào.
 */
export interface IdentityProvisioning {
  ensureLocalUser(input: ProvisionUserInput): Promise<AuthenticatedUser>;
}

export const IDENTITY_PROVISIONING = Symbol('IDENTITY_PROVISIONING');
