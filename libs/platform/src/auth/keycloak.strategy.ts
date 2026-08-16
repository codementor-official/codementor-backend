import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type SecretOrKeyProvider } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { IDENTITY_PROVISIONING, type IdentityProvisioning } from './identity-provisioning.port';
import { Inject, Optional } from '@nestjs/common';
import { platformRoleOf } from './jwt-payload';
import type { AuthenticatedUser, KeycloakToken } from './jwt-payload';

/**
 * Xác minh token Keycloak bằng khoá công khai lấy từ JWKS endpoint (RS256).
 *
 * Backend KHÔNG giữ secret ký token và KHÔNG có endpoint đăng nhập — việc đó thuộc
 * Keycloak, kể cả đăng nhập bằng Google/GitHub/Facebook. Ở đây chỉ có xác minh
 * và ánh xạ sang người dùng nội bộ.
 */
@Injectable()
export class KeycloakStrategy extends PassportStrategy(Strategy, 'keycloak') {
  constructor(
    config: ConfigService,
    // Optional: chỉ core-service có IdentityModule để phân giải `users.id` từ token.
    // Service khác vẫn cần AuthModule để có global guard, nên không được bắt buộc
    // dependency này — thiếu nó thì boot chết cả 7 service chưa có endpoint nào.
    @Optional()
    @Inject(IDENTITY_PROVISIONING)
    private readonly provisioning: IdentityProvisioning | undefined,
  ) {
    const issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Cần chính chuỗi token, không chỉ payload đã giải mã: service không sở hữu bảng
      // `users` phải chuyển tiếp token đó sang core để đổi lấy `users.id`.
      passReqToCallback: true,
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer,
      audience: config.get<string>('KEYCLOAK_AUDIENCE') || undefined,
      // Khoá công khai được cache và tự xoay vòng khi Keycloak đổi khoá.
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: `${issuer}/protocol/openid-connect/certs`,
        cache: true,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      }) as unknown as SecretOrKeyProvider,
    });
  }

  /**
   * Just-in-time provisioning: lần đầu một tài khoản Keycloak gọi API, ta tạo bản ghi
   * `users` tương ứng. Nhờ vậy đăng ký qua social không cần webhook từ Keycloak.
   */
  async validate(
    request: { headers: Record<string, unknown> },
    token: KeycloakToken,
  ): Promise<AuthenticatedUser> {
    const role = platformRoleOf(token);

    // Tài khoản dịch vụ đăng nhập bằng client credentials: không có email, không có hàng
    // trong `users`, và không được provisioning. Phải trả về TRƯỚC lúc đòi email, nếu
    // không mọi lời gọi máy-tới-máy đều bị 401.
    if (role === 'ai_agent') {
      return {
        id: null,
        externalId: token.sub,
        displayName: token.preferred_username ?? 'codementor-ai-agent',
        role,
        actorType: 'service',
      };
    }

    // core-service dùng IdentityModule, 8 service còn lại dùng RemoteIdentityModule.
    // Thiếu cả hai là lỗi lắp ráp module, không phải lỗi của người gọi.
    if (!this.provisioning) {
      throw new UnauthorizedException(
        'Service này chưa nối IDENTITY_PROVISIONING — thêm RemoteIdentityModule vào AppModule',
      );
    }

    if (!token.email) {
      throw new UnauthorizedException('Token thiếu claim email — kiểm tra client scope của Keycloak');
    }

    const authorization = String(request.headers.authorization ?? '');
    return this.provisioning.ensureLocalUser({
      externalId: token.sub,
      email: token.email,
      displayName: token.name ?? token.preferred_username ?? token.email,
      emailVerified: token.email_verified ?? false,
      role,
      accessToken: authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined,
    });
  }
}
