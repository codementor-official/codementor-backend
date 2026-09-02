import { Global, Module } from '@nestjs/common';
import { IDENTITY_PROVISIONING } from '@codementor/platform';
import { GetAdminUserUseCase } from './application/get-admin-user.usecase';
import { GetProfileUseCase } from './application/get-profile.usecase';
import { ListUsersUseCase } from './application/list-users.usecase';
import { MirrorAccountUseCase } from './application/mirror-account.usecase';
import { ProvisionUserUseCase } from './application/provision-user.usecase';
import { UpdateProfileUseCase } from './application/update-profile.usecase';
import { AccountPreferencesService } from './application/account-preferences.service';
import { PresignAvatarUploadUseCase } from './application/presign-avatar-upload.usecase';
import { ACCOUNT_PREFERENCES_REPOSITORY } from './domain/port/account-preferences.repository';
import { AVATAR_STORAGE } from './domain/port/avatar-storage.port';
import { USER_REPOSITORY } from './domain/port/user.repository';
import { IdentityQueryService } from './infrastructure/identity-query.service';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { PrismaAccountPreferencesRepository } from './infrastructure/prisma-account-preferences.repository';
import { ObjectAvatarStorageAdapter } from './infrastructure/object-avatar-storage.adapter';
import { KeycloakAdminService } from './infrastructure/keycloak-admin.service';
import { IDENTITY_QUERY } from './identity.public';
import { AdminUsersController } from './presentation/admin-users.controller';
import { IdentityController } from './presentation/identity.controller';
import { EmailVerificationService } from './application/email-verification.service';
import { EMAIL_VERIFICATION_PROVIDER } from './domain/port/email-verification.provider';

/**
 * Global vì `shared/auth` cần `IDENTITY_PROVISIONING` để just-in-time provisioning
 * khi xác thực. Đây là ngoại lệ có chủ ý và là phụ thuộc DUY NHẤT theo chiều
 * hạ tầng → context, thông qua một port khai báo ở `shared/auth`.
 */
@Global()
@Module({
  // Hai controller, hai đường dẫn: hồ sơ ở `/me` (Kong định tuyến đường đó), quản trị
  // tài khoản Keycloak ở `/users`.
  controllers: [IdentityController, AdminUsersController],
  providers: [
    GetAdminUserUseCase,
    GetProfileUseCase,
    ListUsersUseCase,
    MirrorAccountUseCase,
    ProvisionUserUseCase,
    UpdateProfileUseCase,
    AccountPreferencesService,
    PresignAvatarUploadUseCase,
    KeycloakAdminService,
    EmailVerificationService,
    { provide: EMAIL_VERIFICATION_PROVIDER, useExisting: KeycloakAdminService },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: ACCOUNT_PREFERENCES_REPOSITORY, useClass: PrismaAccountPreferencesRepository },
    { provide: AVATAR_STORAGE, useClass: ObjectAvatarStorageAdapter },
    { provide: IDENTITY_PROVISIONING, useExisting: ProvisionUserUseCase },
    { provide: IDENTITY_QUERY, useClass: IdentityQueryService },
  ],
  exports: [IDENTITY_QUERY, IDENTITY_PROVISIONING],
})
export class IdentityModule {}
