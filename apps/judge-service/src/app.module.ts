import { Module } from '@nestjs/common';
import { ConfigModule, HealthModule, HttpModule, LoggingModule, PrismaModule } from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';

/**
 * judge-service
 *
 * Chạy và chấm code trong sandbox. KHÔNG sở hữu bảng nào.
 *
 * Service NỘI BỘ: không expose Swagger, không nhận request từ frontend.
 *
 * Ranh giới dữ liệu: chỉ được ghi vào bảng mình sở hữu. Đọc dữ liệu service khác
 * qua HTTP client (libs/contracts/clients) hoặc view chỉ-đọc. Ghi chéo service
 * chỉ qua Kafka event. Xem docs/02-service-architecture.md §5.
 */
@Module({
  imports: [
    ConfigModule,
    HealthModule,
    HttpModule,
    LoggingModule,
    // Không sở hữu bảng nào, nhưng EventConsumer vẫn ghi `processed_events` qua Prisma
    // để khử trùng lặp message Kafka.
    PrismaModule,
    MessagingModule.forRoot({ serviceName: 'judge-service' }),
  ],
})
export class AppModule {}
