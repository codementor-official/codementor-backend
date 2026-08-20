import { Module } from '@nestjs/common';
import { AuthModule, RemoteIdentityModule, ConfigModule, HealthModule, HttpModule, LoggingModule, MongoModule, PrismaModule, StorageModule } from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';
import { LearningModule } from './contexts/learning/learning.module';

/**
 * learning-service
 *
 * Learning + Articles. Sở hữu roadmaps, courses, chapters, lessons, dependency graph, enrollment, progress (19 bảng).
 *
 * Ranh giới dữ liệu: chỉ được ghi vào bảng mình sở hữu. Đọc dữ liệu service khác
 * qua HTTP client (libs/contracts/clients) hoặc view chỉ-đọc. Ghi chéo service
 * chỉ qua Kafka event. Xem docs/02-service-architecture.md §5.
 */
@Module({
  imports: [
    AuthModule,
    // Service này không sở hữu bảng `users`; phân giải `sub` của Keycloak sang
    // `users.id` bằng cách hỏi core-service qua HTTP.
    RemoteIdentityModule,
    ConfigModule,
    HealthModule,
    HttpModule,
    LoggingModule,
    MongoModule,
    PrismaModule,
    // Video bài học nằm ở kho đối tượng, không ở CSDL. Chưa cấu hình S3 thì module vẫn
    // nạp và chỉ tắt riêng nút tải lên — xem `ObjectStorageService`.
    StorageModule,
    MessagingModule.forRoot({ serviceName: 'learning-service' }),
    LearningModule,
  ],
})
export class AppModule {}
