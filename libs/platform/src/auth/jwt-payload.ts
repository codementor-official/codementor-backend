/**
 * Access token do **Keycloak** phát (RS256), backend chỉ xác minh chữ ký — không tự ký.
 * Đây là các claim chuẩn OIDC + phần mở rộng của Keycloak mà ta thực sự dùng.
 */
import type { UserRole } from './user-role';

export interface KeycloakToken {
  sub: string; // định danh người dùng ở Keycloak — ổn định, không đổi
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;

  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;

  /** Realm roles are the authorization source of truth. */
  realm_access?: { roles: string[] };

  /** Nhà cung cấp social đã dùng để đăng nhập (google, github...), nếu có. */
  identity_provider?: string;
}

export type PlatformRole = 'learner' | 'mentor' | 'admin';

/**
 * Danh tính đã xác thực gắn vào request.
 *
 * `id` là khoá chính trong bảng `users` của ta, KHÔNG phải `sub` của Keycloak —
 * hai hệ thống được tách rời qua `users.external_id`. Nhờ đó nếu sau này đổi nhà
 * cung cấp danh tính thì chỉ một cột phải đổi.
 */
export interface AuthenticatedUser {
  id: string | null;
  externalId: string;
  email?: string;
  displayName: string;
  roles: UserRole[];
  actorType: 'human' | 'service';
  platformRole?: PlatformRole;
}
