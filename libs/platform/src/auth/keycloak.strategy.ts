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
  async validate(token: KeycloakToken): Promise<AuthenticatedUser> {
    // Fail loud thay vì trả về danh tính nửa vời: `AuthenticatedUser.id` phải là
    // `users.id` nội bộ, chỉ core-service phân giải được. Endpoint @Public() không
    // đi qua đây nên health check của mọi service vẫn chạy.
    if (!this.provisioning) {
      throw new UnauthorizedException(
        'Service này chưa nối IDENTITY_PROVISIONING — endpoint cần xác thực phải nằm ở core-service, hoặc phân giải user qua CORE_CLIENT',
      );
    }

    if (!token.email) {
      throw new UnauthorizedException('Token thiếu claim email — kiểm tra client scope của Keycloak');
    }

    return this.provisioning.ensureLocalUser({
      externalId: token.sub,
      email: token.email,
      displayName: token.name ?? token.preferred_username ?? token.email,
      emailVerified: token.email_verified ?? false,
      role: platformRoleOf(token),
    });
  }
}
