import { Module } from '@nestjs/common';
import { AuthModule, ConfigModule, HealthModule, HttpModule, LoggingModule, MongoModule, PrismaModule } from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';

/**
 * exercise-service
 *
 * Exercise. Sở hữu exercises, exercise_sets, prerequisites, exercise_progress (9 bảng).
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
    MessagingModule.forRoot({ serviceName: 'exercise-service' }),
  ],
})
export class AppModule {}
