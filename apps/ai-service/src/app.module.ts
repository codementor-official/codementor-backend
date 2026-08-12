import { Module } from '@nestjs/common';
import { ConfigModule, HealthModule, HttpModule, LoggingModule, MongoModule, PrismaModule } from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';

/**
 * ai-service
 *
 * Tích hợp AI: hỏi đáp, phân tích lỗi, tiền kiểm tài liệu, sinh bài tập. KHÔNG sở hữu bảng PostgreSQL.
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
    MongoModule,
    PrismaModule,
    MessagingModule.forRoot({ serviceName: 'ai-service' }),
  ],
})
export class AppModule {}
