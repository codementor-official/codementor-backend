import { Module } from '@nestjs/common';
import {
  AuthModule,
  ConfigModule,
  HealthModule,
  HttpModule,
  LoggingModule,
  MongoModule,
  PrismaModule,
  StorageModule,
} from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';
import { IdentityModule } from './contexts/identity/identity.module';
import { AnnouncementModule } from './contexts/announcement/announcement.module';
import { AuditModule } from './contexts/audit/audit.module';
import { CatalogModule } from './contexts/catalog/catalog.module';

/**
 * core-service — Identity + Catalog.
 *
 * Sở hữu: users, user_stats, learning_preferences, study_schedule_slots,
 *         technologies, tags, companies  (7 bảng)
 *
 * Không service nào khác được ghi vào các bảng trên; đọc thì qua HTTP hoặc view
 * `v_user_summary`. Xem docs/02-service-architecture.md §5.
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    PrismaModule,
    StorageModule,
    MongoModule,
    MessagingModule.forRoot({ serviceName: 'core-service', enableOutbox: true }),
    HttpModule,
    HealthModule,

    // AuditModule trước IdentityModule: controller quản trị tài khoản tiêm AuditLogService.
    AuditModule,
    // IdentityModule trước AuthModule: strategy Keycloak cần IDENTITY_PROVISIONING.
    IdentityModule,
    AnnouncementModule,
    CatalogModule,
    AuthModule,
  ],
})
export class AppModule {}
