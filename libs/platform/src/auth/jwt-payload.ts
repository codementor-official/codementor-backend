/**
 * Access token do **Keycloak** phát (RS256), backend chỉ xác minh chữ ký — không tự ký.
 * Đây là các claim chuẩn OIDC + phần mở rộng của Keycloak mà ta thực sự dùng.
 */
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

  /** Vai trò cấp realm. Xem `platformRoleOf` — quyền cao nhất thắng. */
  realm_access?: { roles: string[] };

  /** Nhà cung cấp social đã dùng để đăng nhập (google, github...), nếu có. */
  identity_provider?: string;
}

/**
 * Khớp 1-1 với enum `platform_role` trong PostgreSQL và realm role của Keycloak.
 * Ba tên phải giống hệt nhau, nếu không thì `role = $n::platform_role` sẽ nổ lúc INSERT.
 */
export type PlatformRole = 'learner' | 'lecturer' | 'admin';

/** Xếp từ quyền cao xuống thấp. Ai có nhiều role thì lấy cái cao nhất. */
const ROLE_PRECEDENCE: readonly PlatformRole[] = ['admin', 'lecturer', 'learner'];

/**
 * Tên realm role → vai trò nền tảng.
 *
 * Realm dùng hai cách đặt tên song song: `learner`/`lecturer`/`admin` từ bản import
 * đầu tiên, và `STUDENT`/`LECTURER`/`ADMIN` do đợt cấu hình sau. Không chọn được một
 * bên rồi ép bên kia đổi theo: chữ thường phải giữ vì nó là giá trị của enum
 * `platform_role` trong PostgreSQL, còn chữ hoa đang được các tài khoản thật dùng.
 *
 * So khớp không phân biệt hoa thường và có bí danh, nên thêm một cách gọi nữa sau này
 * chỉ là thêm một dòng ở đây.
 */
const ROLE_ALIASES: Record<string, PlatformRole> = {
  admin: 'admin',
  lecturer: 'lecturer',
  learner: 'learner',
  student: 'learner',
};

/**
 * Keycloak là nguồn sự thật cho vai trò cấp nền tảng.
 * Không có realm role nào khớp thì mặc định là learner — token hợp lệ luôn phải
 * ra được một vai trò, còn quyền hạn chi tiết do từng endpoint tự kiểm.
 */
export function platformRoleOf(token: KeycloakToken): PlatformRole {
  const granted = new Set<PlatformRole>();
  for (const name of token.realm_access?.roles ?? []) {
    const mapped = ROLE_ALIASES[name.toLowerCase()];
    if (mapped) granted.add(mapped);
  }
  return ROLE_PRECEDENCE.find((role) => granted.has(role)) ?? 'learner';
}

/**
 * Danh tính đã xác thực gắn vào request.
 *
 * `id` là khoá chính trong bảng `users` của ta, KHÔNG phải `sub` của Keycloak —
 * hai hệ thống được tách rời qua `users.external_id`. Nhờ đó nếu sau này đổi nhà
 * cung cấp danh tính thì chỉ một cột phải đổi.
 */
export interface AuthenticatedUser {
  id: string;
  externalId: string;
  email: string;
  displayName: string;
  role: PlatformRole;
}
