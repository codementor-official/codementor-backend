import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwksClient } from 'jwks-rsa';
import { verify, type JwtHeader } from 'jsonwebtoken';
import { platformRoleOf, type KeycloakToken, type PlatformRole } from '@codementor/platform';

export interface SocketIdentity {
  /** `sub` của Keycloak. KHÔNG phải `users.id` — realtime-service không đọc bảng `users`. */
  externalId: string;
  role: PlatformRole;
}

/**
 * Xác thực lúc bắt tay WebSocket, dùng đúng nguồn tin cậy mà HTTP đang dùng: JWKS của
 * Keycloak, thuật toán RS256, kiểm cả issuer lẫn audience.
 *
 * Không có cơ chế đăng nhập riêng cho realtime, và tuyệt đối không nhận `userId` do
 * client gửi kèm: bất kỳ ai cũng gõ được một userId vào query string, nên tin nó đồng
 * nghĩa với việc mở toang mọi phòng cho mọi người.
 */
@Injectable()
export class HandshakeAuthService {
  private readonly logger = new Logger(HandshakeAuthService.name);
  private readonly issuer: string;
  private readonly audience?: string;
  private readonly jwks: JwksClient;

  constructor(config: ConfigService) {
    this.issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
    this.audience = config.get<string>('KEYCLOAK_AUDIENCE') || undefined;
    this.jwks = new JwksClient({
      jwksUri: `${this.issuer}/protocol/openid-connect/certs`,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  /** Trả về danh tính, hoặc `null` nếu token thiếu/sai/hết hạn. */
  async verify(token: string | undefined): Promise<SocketIdentity | null> {
    if (!token) return null;

    try {
      const payload = await new Promise<KeycloakToken>((resolve, reject) => {
        verify(
          token,
          (header: JwtHeader, callback) => {
            this.jwks
              .getSigningKey(header.kid)
              .then((key) => callback(null, key.getPublicKey()))
              .catch(callback);
          },
          {
            algorithms: ['RS256'],
            issuer: this.issuer,
            audience: this.audience,
          },
          (error, decoded) => (error ? reject(error) : resolve(decoded as KeycloakToken)),
        );
      });

      return { externalId: payload.sub, role: platformRoleOf(payload) };
    } catch (error) {
      // Token hỏng là chuyện thường ngày (hết hạn giữa lúc mở tab), không phải sự cố.
      this.logger.debug(`từ chối bắt tay: ${(error as Error).message}`);
      return null;
    }
  }
}
