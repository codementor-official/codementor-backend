import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IdentityProvisioning, ProvisionUserInput } from './identity-provisioning.port';
import type { AuthenticatedUser, PlatformRole } from './jwt-payload';

interface CachedIdentity {
  user: AuthenticatedUser;
  expiresAt: number;
}

/**
 * Phân giải danh tính cho 8 service KHÔNG sở hữu bảng `users`.
 *
 * `AuthenticatedUser.id` là `users.id` nội bộ, không phải `sub` của Keycloak — token
 * không mang nó, và chỉ core-service được đọc bảng `users`
 * (`docs/02-service-architecture.md §5`). Nên service khác hỏi core qua HTTP bằng chính
 * bearer token của request: core vừa phân giải, vừa tạo hồ sơ lần đầu nếu chưa có.
 *
 * Dùng token của người gọi chứ không phải service account: nếu core từ chối họ thì ở đây
 * cũng phải từ chối, và không service nào cầm sẵn quyền đọc hồ sơ của người khác.
 */
@Injectable()
export class RemoteIdentityProvisioning implements IdentityProvisioning {
  private readonly logger = new Logger(RemoteIdentityProvisioning.name);
  private readonly coreUrl: string;

  /**
   * Cache theo access token. Token sống ~5 phút nên tối đa một lượt gọi core cho mỗi
   * người dùng, mỗi service, mỗi 5 phút — thay vì một lượt cho mỗi request.
   *
   * Khoá là chính token: hết hạn thì client đổi token, mục cũ không bao giờ trúng nữa.
   */
  private readonly cache = new Map<string, CachedIdentity>();

  constructor(config: ConfigService) {
    this.coreUrl = config.get<string>('CORE_SERVICE_URL', 'http://localhost:3001');
  }

  async ensureLocalUser(input: ProvisionUserInput): Promise<AuthenticatedUser> {
    if (!input.accessToken) {
      throw new UnauthorizedException('Thiếu access token để phân giải danh tính');
    }

    const cached = this.cache.get(input.accessToken);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const response = await this.fetchProfile(input.accessToken);

    const user: AuthenticatedUser = {
      id: response.id,
      // core không trả external_id; nó chính là `sub` trong token đang cầm.
      externalId: input.externalId,
      email: response.email,
      displayName: response.displayName,
      role: response.role,
    };

    this.cache.set(input.accessToken, { user, expiresAt: this.expiryOf(input.accessToken) });
    this.evictExpired();
    return user;
  }

  private async fetchProfile(accessToken: string) {
    let response: Response;
    try {
      response = await fetch(`${this.coreUrl}/api/v1/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch (cause) {
      // Core chết thì đây là lỗi hạ tầng, không phải lỗi xác thực của người dùng —
      // trả 401 sẽ khiến frontend đá họ ra màn đăng nhập một cách vô nghĩa.
      this.logger.error(`Không gọi được core-service tại ${this.coreUrl}`, cause as Error);
      throw new ServiceUnavailableException('Không phân giải được danh tính');
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException('Danh tính bị core-service từ chối');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(`core-service trả ${response.status}`);
    }

    const body = (await response.json()) as {
      data: { id: string; email: string; displayName: string; role: PlatformRole };
    };
    return body.data;
  }

  /** `exp` trong token, trừ hao 30 giây để không dùng đúng mục vừa hết hạn. */
  private expiryOf(accessToken: string): number {
    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as { exp?: number };
      if (payload.exp) return payload.exp * 1000 - 30_000;
    } catch {
      // Token không đọc được thì đã không qua được guard; cứ dùng mốc mặc định.
    }
    return Date.now() + 60_000;
  }

  /** Không có TTL tự động nên phải tự dọn, nếu không map lớn dần theo số lượt đăng nhập. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(token);
    }
  }
}
