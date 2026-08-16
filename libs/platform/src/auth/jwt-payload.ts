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

  /** Vai trò cấp realm — nguồn sự thật cho phân quyền. Xem `platformRoleOf`. */
  realm_access?: { roles: string[] };

  /** Nhà cung cấp social đã dùng để đăng nhập (google, github...), nếu có. */
  identity_provider?: string;
}

/**
 * Khớp 1-1 với enum `platform_role` trong PostgreSQL và realm role của Keycloak.
 * Ba tên phải giống hệt nhau, nếu không thì `role = $n::platform_role` sẽ nổ lúc INSERT.
 */
export type PlatformRole = 'learner' | 'lecturer' | 'admin' | 'ai_agent';

/**
 * Vai trò gắn được với một hàng trong `users`.
 *
 * Enum `platform_role` ở PostgreSQL không có `ai_agent`, và đúng như vậy: tài khoản dịch vụ
 * đăng nhập bằng client credentials và được trả về trước bước provisioning. Kiểu này khiến
 * điều đó là lỗi biên dịch chứ không phải lỗi lúc INSERT.
 */
export type HumanRole = Exclude<PlatformRole, 'ai_agent'>;

/** Xếp từ quyền cao xuống thấp. Ai có nhiều role thì lấy cái cao nhất. */
const ROLE_PRECEDENCE: readonly PlatformRole[] = ['admin', 'lecturer', 'ai_agent', 'learner'];

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
  // Tài khoản dịch vụ (AI agent) đăng nhập bằng client credentials, không phải người.
  ai_agent: 'ai_agent',
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
  /**
   * `null` với tài khoản dịch vụ (AI agent): chúng đăng nhập bằng client credentials và
   * không có hàng nào trong `users`. Mọi kiểm quyền sở hữu phải xử lý được `null` —
   * không có chủ sở hữu thì không sở hữu gì.
   */
  id: string | null;
  externalId: string;
  email?: string;
  displayName: string;
  /**
   * MỘT vai trò đã phân giải, không phải danh sách. `platformRoleOf` chọn quyền cao nhất,
   * nên phân quyền chỉ phải so sánh một giá trị. Tên vai trò thô của Keycloak vẫn dùng
   * được ở tầng quản trị Keycloak (`UserRole` trong `user-role.ts`).
   */
  role: PlatformRole;
  actorType: 'human' | 'service';
}
