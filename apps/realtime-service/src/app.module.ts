import { Module } from '@nestjs/common';
import { AuthModule, ConfigModule, HealthModule, HttpModule, LoggingModule } from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';

/**
 * realtime-service
 *
 * Cầu nối Kafka -> WebSocket/SSE. KHÔNG sở hữu bảng nào, KHÔNG có business logic.
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
    MessagingModule.forRoot({ serviceName: 'realtime-service' }),
  ],
})
export class AppModule {}
