import { Global, Module } from '@nestjs/common';
import { IDENTITY_PROVISIONING } from '@codementor/platform';
import { ProvisionUserUseCase } from './application/provision-user.usecase';
import { USER_REPOSITORY } from './domain/port/user.repository';
import { IdentityQueryService } from './infrastructure/identity-query.service';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { KeycloakAdminService } from './infrastructure/keycloak-admin.service';
import { IDENTITY_QUERY } from './identity.public';
import { IdentityController } from './presentation/identity.controller';

/**
 * Global vì `shared/auth` cần `IDENTITY_PROVISIONING` để just-in-time provisioning
 * khi xác thực. Đây là ngoại lệ có chủ ý và là phụ thuộc DUY NHẤT theo chiều
 * hạ tầng → context, thông qua một port khai báo ở `shared/auth`.
 */
@Global()
@Module({
  controllers: [IdentityController],
  providers: [
    ProvisionUserUseCase,
    KeycloakAdminService,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: IDENTITY_PROVISIONING, useExisting: ProvisionUserUseCase },
    { provide: IDENTITY_QUERY, useClass: IdentityQueryService },
  ],
  exports: [IDENTITY_QUERY, IDENTITY_PROVISIONING],
})
export class IdentityModule {}
