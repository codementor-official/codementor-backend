import { AggregateRoot } from '@codementor/kernel';
import { BusinessRuleViolation, Result } from '@codementor/kernel';
import { UserRegistered } from '../event/user-registered.event';
import type { Email } from './email';
import type { Handle } from './handle';

/**
 * Cố ý khai báo lại thay vì import từ `@codementor/platform`: tầng domain không được
 * phụ thuộc hạ tầng. Đổi một bên thì phải đổi bên kia — và cả enum `platform_role`
 * trong PostgreSQL lẫn realm role của Keycloak.
 */
export type PlatformRole = 'learner' | 'lecturer' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'deleted';

interface UserProps {
  /** `sub` của Keycloak. Nguồn sự thật về danh tính nằm ở Keycloak, không ở đây. */
  externalId: string;
  email: Email;
  displayName: string;
  handle: Handle | null;
  role: PlatformRole;
  status: AccountStatus;
  emailVerifiedAt: Date | null;
}

/**
 * Hồ sơ người dùng nội bộ — **hình chiếu** của tài khoản Keycloak.
 *
 * Aggregate này KHÔNG giữ mật khẩu: Keycloak sở hữu credential và mọi luồng đăng nhập
 * (kể cả social). Ở đây chỉ giữ dữ liệu thuộc về sản phẩm: tên hiển thị, handle,
 * trạng thái tài khoản trong CodeMentor.
 */
export class User extends AggregateRoot<string> {
  private constructor(
    id: string,
    private props: UserProps,
  ) {
    super(id);
  }

  /** Khôi phục từ CSDL — không phát sự kiện. */
  static rehydrate(id: string, props: UserProps): User {
    return new User(id, props);
  }

  /**
   * Tạo hồ sơ nội bộ lần đầu tài khoản Keycloak gọi API (just-in-time provisioning).
   * Phát sự kiện để context khác phản ứng, ví dụ tạo preference mặc định.
   */
  static provision(params: {
    id: string;
    externalId: string;
    email: Email;
    displayName: string;
    emailVerified: boolean;
    role: PlatformRole;
  }): User {
    const user = new User(params.id, {
      externalId: params.externalId,
      email: params.email,
      displayName: params.displayName.trim() || params.email.value,
      handle: null,
      role: params.role,
      status: 'active',
      emailVerifiedAt: params.emailVerified ? new Date() : null,
    });
    user.addEvent(new UserRegistered(params.id, params.email.value, user.displayName));
    return user;
  }

  get externalId(): string {
    return this.props.externalId;
  }
  get email(): Email {
    return this.props.email;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get role(): PlatformRole {
    return this.props.role;
  }
  get status(): AccountStatus {
    return this.props.status;
  }
  get handle(): Handle | null {
    return this.props.handle;
  }
  get isEmailVerified(): boolean {
    return this.props.emailVerifiedAt !== null;
  }

  /**
   * Token hợp lệ chưa đủ — tài khoản còn phải đang hoạt động phía CodeMentor.
   * Cho phép khoá người dùng ở sản phẩm mà không cần đụng tới Keycloak.
   */
  canAccessPlatform(): Result<true, BusinessRuleViolation> {
    if (this.props.status === 'deleted') {
      return Result.fail(new BusinessRuleViolation('Tài khoản đã bị xoá'));
    }
    if (this.props.status === 'suspended') {
      return Result.fail(new BusinessRuleViolation('Tài khoản đang bị tạm khoá'));
    }
    return Result.ok(true);
  }

  /** Đồng bộ lại các claim có thể đổi ở Keycloak. Trả về true nếu có thay đổi cần lưu. */
  syncFromProvider(params: {
    email: Email;
    displayName: string;
    emailVerified: boolean;
    role: PlatformRole;
  }): boolean {
    let changed = false;

    if (!this.props.email.equals(params.email)) {
      this.props.email = params.email;
      changed = true;
    }
    // Keycloak là nguồn sự thật cho vai trò cấp nền tảng.
    if (this.props.role !== params.role) {
      this.props.role = params.role;
      changed = true;
    }
    if (params.emailVerified && this.props.emailVerifiedAt === null) {
      this.props.emailVerifiedAt = new Date();
      changed = true;
    }
    return changed;
  }

  changeDisplayName(name: string): Result<true, BusinessRuleViolation> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return Result.fail(new BusinessRuleViolation('Tên hiển thị không được để trống'));
    }
    this.props.displayName = trimmed;
    return Result.ok(true);
  }

  assignHandle(handle: Handle): void {
    this.props.handle = handle;
  }

  /** Xoá mềm — giữ bản ghi để bài nộp và nội dung đã soạn còn tác giả hợp lệ. */
  softDelete(): void {
    this.props.status = 'deleted';
  }
}
