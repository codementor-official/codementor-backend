import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type SecretOrKeyProvider } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { IDENTITY_PROVISIONING, type IdentityProvisioning } from './identity-provisioning.port';
import { Inject } from '@nestjs/common';
import type { AuthenticatedUser, KeycloakToken, PlatformRole } from './jwt-payload';

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
    @Inject(IDENTITY_PROVISIONING) private readonly provisioning: IdentityProvisioning,
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
    if (!token.email) {
      throw new UnauthorizedException('Token thiếu claim email — kiểm tra client scope của Keycloak');
    }

    const role: PlatformRole = token.realm_access?.roles?.includes('admin') ? 'admin' : 'learner';

    return this.provisioning.ensureLocalUser({
      externalId: token.sub,
      email: token.email,
      displayName: token.name ?? token.preferred_username ?? token.email,
      emailVerified: token.email_verified ?? false,
      role,
    });
  }
}
