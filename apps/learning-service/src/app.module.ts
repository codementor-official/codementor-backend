import { Module } from '@nestjs/common';
import { AuthModule, ConfigModule, HealthModule, HttpModule, LoggingModule, MongoModule, PrismaModule } from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';

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
    ConfigModule,
    HealthModule,
    HttpModule,
    LoggingModule,
    MongoModule,
    PrismaModule,
    MessagingModule.forRoot({ serviceName: 'learning-service' }),
  ],
})
export class AppModule {}
