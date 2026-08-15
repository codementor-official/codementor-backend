import { AggregateRoot } from '@codementor/kernel';
import { BusinessRuleViolation, InvalidInput, Result } from '@codementor/kernel';
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
  bio: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  githubHandle: string | null;
  locale: string;
  timezone: string;
}

/** Phần hồ sơ người dùng tự sửa được. Vắng mặt = giữ nguyên, `null` = xoá. */
export interface ProfileEdit {
  displayName?: string;
  handle?: Handle | null;
  bio?: string | null;
  avatarUrl?: string | null;
  websiteUrl?: string | null;
  githubHandle?: string | null;
  locale?: string;
  timezone?: string;
}

const MAX_DISPLAY_NAME = 120;
const MAX_BIO = 2000;

/** Chỉ http/https. Cho phép `javascript:` vào `websiteUrl` là mở đường cho XSS ở nơi render. */
function checkHttpUrl(field: string, raw: string): InvalidInput | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new InvalidInput('Địa chỉ web không hợp lệ', { [field]: raw });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new InvalidInput('Địa chỉ web phải bắt đầu bằng http:// hoặc https://', {
      [field]: raw,
    });
  }
  return null;
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
      bio: null,
      avatarUrl: null,
      websiteUrl: null,
      githubHandle: null,
      // Khớp DEFAULT của cột trong PostgreSQL, để hàng vừa tạo và hàng đọc lại giống nhau.
      locale: 'vi',
      timezone: 'Asia/Ho_Chi_Minh',
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

  get bio(): string | null {
    return this.props.bio;
  }
  get avatarUrl(): string | null {
    return this.props.avatarUrl;
  }
  get websiteUrl(): string | null {
    return this.props.websiteUrl;
  }
  get githubHandle(): string | null {
    return this.props.githubHandle;
  }
  get locale(): string {
    return this.props.locale;
  }
  get timezone(): string {
    return this.props.timezone;
  }

  /**
   * Sửa hồ sơ. Vắng mặt một trường = giữ nguyên, nên PATCH một trường không xoá phần còn lại.
   *
   * Email, vai trò và trạng thái KHÔNG sửa được ở đây: email thuộc Keycloak, vai trò do
   * Keycloak cấp, trạng thái là việc của quản trị. Cho sửa ở đây là để người dùng tự
   * nâng quyền cho mình.
   */
  updateProfile(edit: ProfileEdit): Result<true, InvalidInput> {
    if (edit.displayName !== undefined) {
      const trimmed = edit.displayName.trim();
      if (trimmed.length === 0) {
        return Result.fail(new InvalidInput('Tên hiển thị không được để trống'));
      }
      if (trimmed.length > MAX_DISPLAY_NAME) {
        return Result.fail(
          new InvalidInput(`Tên hiển thị tối đa ${MAX_DISPLAY_NAME} ký tự`, {
            length: trimmed.length,
          }),
        );
      }
      this.props.displayName = trimmed;
    }

    if (edit.bio !== undefined) {
      const trimmed = edit.bio?.trim() ?? null;
      if (trimmed !== null && trimmed.length > MAX_BIO) {
        return Result.fail(
          new InvalidInput(`Giới thiệu tối đa ${MAX_BIO} ký tự`, { length: trimmed.length }),
        );
      }
      this.props.bio = trimmed || null;
    }

    for (const field of ['avatarUrl', 'websiteUrl'] as const) {
      if (edit[field] === undefined) continue;
      const trimmed = edit[field]?.trim() ?? null;
      if (trimmed) {
        const invalid = checkHttpUrl(field, trimmed);
        if (invalid) return Result.fail(invalid);
      }
      this.props[field] = trimmed || null;
    }

    if (edit.githubHandle !== undefined) {
      const trimmed = edit.githubHandle?.trim() ?? null;
      if (trimmed && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(trimmed)) {
        return Result.fail(
          new InvalidInput('Tên GitHub không hợp lệ', { githubHandle: trimmed }),
        );
      }
      this.props.githubHandle = trimmed || null;
    }

    if (edit.handle !== undefined) this.props.handle = edit.handle;
    if (edit.locale !== undefined) this.props.locale = edit.locale;
    if (edit.timezone !== undefined) this.props.timezone = edit.timezone;

    return Result.ok(true);
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
