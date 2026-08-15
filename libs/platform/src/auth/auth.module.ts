import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { KeycloakAuthGuard } from './jwt-auth.guard';
import { KeycloakStrategy } from './keycloak.strategy';
import { RolesGuard } from './roles.guard';

/**
 * Không có JwtModule: backend là **resource server**, chỉ xác minh token do Keycloak ký.
 * Đăng nhập, đăng ký, social login, đổi mật khẩu, refresh token — Keycloak lo hết.
 *
 * `IDENTITY_PROVISIONING` do IdentityModule cung cấp (import trước AuthModule trong AppModule).
 */
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'keycloak' })],
  providers: [
    KeycloakStrategy,
    { provide: APP_GUARD, useClass: KeycloakAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [PassportModule],
})
export class AuthModule {}

