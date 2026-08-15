import { Global, Module } from '@nestjs/common';
import { IDENTITY_PROVISIONING } from '@codementor/platform';
import { GetProfileUseCase } from './application/get-profile.usecase';
import { ProvisionUserUseCase } from './application/provision-user.usecase';
import { UpdateProfileUseCase } from './application/update-profile.usecase';
import { USER_REPOSITORY } from './domain/port/user.repository';
import { IdentityQueryService } from './infrastructure/identity-query.service';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
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
    GetProfileUseCase,
    ProvisionUserUseCase,
    UpdateProfileUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: IDENTITY_PROVISIONING, useExisting: ProvisionUserUseCase },
    { provide: IDENTITY_QUERY, useClass: IdentityQueryService },
  ],
  exports: [IDENTITY_QUERY, IDENTITY_PROVISIONING],
})
export class IdentityModule {}
