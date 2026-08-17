import { Module } from '@nestjs/common';
import {
  AuthModule,
  ConfigModule,
  HealthModule,
  HttpModule,
  LoggingModule,
  MongoModule,
  PrismaModule,
  RemoteIdentityModule,
} from '@codementor/platform';
import { MessagingModule } from '@codementor/messaging';
import { NotificationModule } from './contexts/notification/notification.module';

/**
 * notification-service
 *
 * Sở hữu `notifications` và `notification_reads` trong MongoDB. Không sở hữu bảng
 * PostgreSQL nào — `PrismaModule` có mặt chỉ vì `EventConsumer` ghi `processed_events`
 * để khử trùng lặp message.
 *
 * Việc đẩy realtime KHÔNG nằm ở đây: service này phát `evt.notification.created.v1`,
 * realtime-service nghe và đẩy xuống WebSocket. Đó là ranh giới đã có trong
 * docs/02-service-architecture.md §7 — realtime-service là cầu nối Kafka → client duy
 * nhất, nhờ vậy client chỉ mở một socket cho toàn bộ hệ thống.
 *
 * Ranh giới dữ liệu: chỉ được ghi vào collection mình sở hữu. Đọc dữ liệu service khác
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
    MessagingModule.forRoot({ serviceName: 'notification-service' }),
    NotificationModule,
  ],
})
export class AppModule {}
