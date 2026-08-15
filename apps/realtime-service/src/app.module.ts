import { Module } from '@nestjs/common';
import { AuthModule, RemoteIdentityModule, ConfigModule, HealthModule, HttpModule, LoggingModule } from '@codementor/platform';
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
    // Service này không sở hữu bảng `users`; phân giải `sub` của Keycloak sang
    // `users.id` bằng cách hỏi core-service qua HTTP.
    RemoteIdentityModule,
    ConfigModule,
    HealthModule,
    HttpModule,
    LoggingModule,
    MessagingModule.forRoot({ serviceName: 'realtime-service' }),
  ],
})
export class AppModule {}
