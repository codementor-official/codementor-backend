// Ràng buộc khi quản trị viên đổi vai trò hoặc khoá/mở tài khoản. Luật thuần để test được;
// controller tra dữ kiện từ bảng `users` rồi hỏi ở đây trước khi gọi Keycloak.

export type PlatformRole = 'learner' | 'lecturer' | 'admin';

export function roleChangeBlocker(input: {
  selfChange: boolean;
  currentRole: string | null;
  currentStatus: string | null;
  nextRole: PlatformRole;
  activeAdmins: number;
}): string | null {
  if (input.selfChange) return 'Không thể tự đổi vai trò của chính mình.';
  if (input.currentStatus !== null && input.currentStatus !== 'active')
    return 'Chỉ đổi vai trò cho tài khoản đang hoạt động — mở khoá trước.';
  if (input.currentRole === input.nextRole) return 'Tài khoản đã có vai trò này.';
  if (input.currentRole === 'admin' && input.nextRole !== 'admin' && input.activeAdmins <= 1)
    return 'Không thể hạ quyền quản trị viên cuối cùng của hệ thống.';
  return null;
}

export function statusChangeBlocker(input: {
  selfChange: boolean;
  suspend: boolean;
  currentStatus: string | null;
  currentRole: string | null;
  activeAdmins: number;
}): string | null {
  if (input.selfChange) return 'Không thể tự khoá hoặc mở khoá tài khoản của chính mình.';
  if (input.suspend && input.currentStatus === 'suspended') return 'Tài khoản đang bị khoá rồi.';
  if (!input.suspend && input.currentStatus === 'active') return 'Tài khoản đang hoạt động.';
  if (input.suspend && input.currentRole === 'admin' && input.activeAdmins <= 1)
    return 'Không thể khoá quản trị viên cuối cùng của hệ thống.';
  return null;
}
