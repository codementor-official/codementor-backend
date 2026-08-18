import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HUMAN_ROLES, type UserRole } from '@codementor/platform';

interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
}

interface KeycloakRoleRepresentation {
  id: string;
  name: string;
}

interface KeycloakUserRepresentation {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
}

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  enabled: boolean;
  roles: UserRole[];
}

/** Đúng hình dạng Keycloak trả về ở `/events`, chưa dịch sang ngôn ngữ của ta. */
interface KeycloakEventRepresentation {
  time: number;
  type: string;
  ipAddress?: string;
  clientId?: string;
  details?: Record<string, string>;
}

/** Một lần đăng nhập, đăng xuất hoặc đăng nhập hỏng. */
export interface LoginEvent {
  type: string;
  occurredAt: string;
  ipAddress: string | null;
  clientId: string | null;
  /** Chỉ có ở sự kiện lỗi: `invalid_user_credentials`, `user_disabled`… */
  error: string | null;
}

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private readonly baseUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('KEYCLOAK_URL').replace(/\/$/, '');
    this.realm = config.getOrThrow<string>('KEYCLOAK_REALM');
    this.clientId = config.getOrThrow<string>('KEYCLOAK_USER_SERVICE_CLIENT_ID');
    this.clientSecret = config.getOrThrow<string>('KEYCLOAK_USER_SERVICE_CLIENT_SECRET');
  }

  async listUsers(): Promise<ManagedUser[]> {
    const users = await this.request<KeycloakUserRepresentation[]>('/users?max=100');
    return Promise.all(users.map((user) => this.toManagedUser(user)));
  }

  async createUser(input: {
    email: string;
    displayName: string;
    role: UserRole;
    password: string;
  }): Promise<ManagedUser> {
    const response = await this.rawRequest('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        firstName: input.displayName,
        enabled: true,
        emailVerified: false,
      }),
    });
    if (response.status === 409) throw new ConflictException('Email đã tồn tại trong Keycloak');
    await this.ensureSuccess(response);

    const id = response.headers.get('location')?.split('/').at(-1);
    if (!id) throw new BadGatewayException('Keycloak không trả về user id');

    // Keycloak đã tạo xong tài khoản ở trên. Mọi bước sau đây mà hỏng đều để lại một tài
    // khoản không vai trò, và lần thử lại với cùng email sẽ nhận 409 — địa chỉ đó coi như
    // mất luôn. Hỏng thì xoá đi, để người dùng tạo lại được.
    try {
      // `temporary: false` là bắt buộc chứ không phải lựa chọn: mật khẩu tạm bật required
      // action `UPDATE_PASSWORD`, và Direct Access Grant không có màn hình nào để làm việc
      // đó — nó trả `invalid_grant`, người dùng nhận đúng thông báo "sai mật khẩu".
      await this.request(`/users/${id}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ type: 'password', value: input.password, temporary: false }),
      });
      await this.assignHumanRole(id, input.role);
      return await this.getUser(id);
    } catch (error) {
      await this.deleteUserQuietly(id);
      throw error;
    }
  }

  /**
   * Xoá một tài khoản vừa tạo dở dang. Nuốt lỗi thất bại của chính nó: nếu dọn dẹp không
   * được thì lỗi đang được ném ra ngoài mới là thứ cần báo, còn "xoá không được" chỉ làm
   * lu mờ nguyên nhân thật.
   */
  private async deleteUserQuietly(userId: string): Promise<void> {
    try {
      await this.request(`/users/${userId}`, { method: 'DELETE' });
      this.logger.warn(`đã xoá tài khoản tạo dở dang: ${userId}`);
    } catch (error) {
      this.logger.error(`không xoá được tài khoản tạo dở dang ${userId}`, error as Error);
    }
  }

  async assignHumanRole(userId: string, role: UserRole): Promise<ManagedUser> {
    if (!(HUMAN_ROLES as readonly UserRole[]).includes(role)) {
      throw new BadGatewayException('AI_AGENT không thể gán cho tài khoản con người');
    }

    const current = await this.request<KeycloakRoleRepresentation[]>(
      `/users/${userId}/role-mappings/realm`,
    );
    const humanRoleNames = new Set<string>(HUMAN_ROLES);
    const toRemove = current.filter((item) => humanRoleNames.has(item.name));
    if (toRemove.length) {
      await this.request(`/users/${userId}/role-mappings/realm`, {
        method: 'DELETE',
        body: JSON.stringify(toRemove),
      });
    }

    const representation = await this.request<KeycloakRoleRepresentation>(
      `/roles/${encodeURIComponent(role)}`,
    );
    await this.request(`/users/${userId}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify([representation]),
    });
    return this.getUser(userId);
  }

  async setEnabled(userId: string, enabled: boolean): Promise<ManagedUser> {
    await this.request(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    return this.getUser(userId);
  }

  /**
   * Lịch sử đăng nhập của một tài khoản, mới nhất trước.
   *
   * Keycloak là nơi DUY NHẤT biết chuyện này: mọi đường đăng nhập — form trong Next.js
   * qua Direct Access Grant, popup Google/Facebook — đều kết thúc ở đó, còn backend chỉ
   * nhìn thấy token đã phát. Chép lại sang bảng của ta sẽ là bản sao luôn thiếu những lần
   * đăng nhập HỎNG, mà đó lại là thứ cần nhất khi tra một tài khoản khả nghi.
   *
   * Trả mảng rỗng khi Keycloak từ chối, thay vì ném lỗi: sự kiện có thể chưa được bật
   * trong realm, hoặc service account chưa có `view-events`, và cả hai đều không phải lý
   * do để cả trang chi tiết tài khoản không mở được. Lỗi cấu hình đi vào log ứng dụng.
   */
  async listLoginEvents(keycloakUserId: string, max = 30): Promise<LoginEvent[]> {
    const query = new URLSearchParams({ user: keycloakUserId, max: String(Math.min(max, 100)) });
    // Lọc loại ngay ở Keycloak: `max` áp trước khi lọc, nên xin về 30 sự kiện bất kỳ rồi
    // tự lọc có thể ra 0 dòng đăng nhập dù tài khoản đăng nhập suốt.
    for (const type of ['LOGIN', 'LOGIN_ERROR', 'LOGOUT']) query.append('type', type);

    const response = await this.rawRequest(`/events?${query.toString()}`);
    if (!response.ok) {
      this.logger.warn(
        `không đọc được lịch sử đăng nhập (HTTP ${response.status}). Kiểm tra realm đã bật events và service account có view-events chưa.`,
      );
      return [];
    }

    const events = (await response.json()) as KeycloakEventRepresentation[];
    return events.map((event) => ({
      type: event.type,
      occurredAt: new Date(event.time).toISOString(),
      ipAddress: event.ipAddress ?? null,
      clientId: event.clientId ?? null,
      error: event.details?.['error'] ?? null,
    }));
  }

  private async getUser(id: string): Promise<ManagedUser> {
    const user = await this.request<KeycloakUserRepresentation>(`/users/${id}`);
    return this.toManagedUser(user);
  }

  private async toManagedUser(user: KeycloakUserRepresentation): Promise<ManagedUser> {
    const roles = await this.request<KeycloakRoleRepresentation[]>(
      `/users/${user.id}/role-mappings/realm`,
    );
    const humanRoleNames = new Set<string>(HUMAN_ROLES);
    return {
      id: user.id,
      email: user.email ?? user.username ?? '',
      displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || '',
      enabled: user.enabled ?? false,
      roles: roles.map((item) => item.name).filter((role): role is UserRole => humanRoleNames.has(role)),
    };
  }

  private async request<T = void>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.rawRequest(path, init);
    await this.ensureSuccess(response);
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private async rawRequest(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.serviceToken();
    return fetch(`${this.baseUrl}/admin/realms/${this.realm}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  }

  private async ensureSuccess(response: Response): Promise<void> {
    if (response.ok) return;
    if (response.status === 404) throw new NotFoundException('Không tìm thấy user Keycloak');
    throw new BadGatewayException(`Keycloak Admin API trả về HTTP ${response.status}`);
  }

  private async serviceToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) return this.cachedToken.value;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = await fetch(
      `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      { method: 'POST', body },
    );
    if (!response.ok) throw new BadGatewayException('Không lấy được Keycloak service token');

    const token = (await response.json()) as KeycloakTokenResponse;
    this.cachedToken = {
      value: token.access_token,
      expiresAt: Date.now() + Math.max(token.expires_in - 30, 1) * 1000,
    };
    return token.access_token;
  }
}
