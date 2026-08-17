import { Module, type OnModuleInit } from '@nestjs/common';
import { EventConsumer } from '@codementor/messaging';
import { TOPICS } from '@codementor/contracts';
import { HandshakeAuthService } from './handshake-auth.service';
import { NotificationGateway } from './notification.gateway';

/**
 * Kafka → WebSocket. Không đọc DB, không dựng nội dung: `evt.notification.created.v1`
 * đã mang đủ chữ để hiển thị, và đó là lý do payload của nó dày như vậy.
 *
 * Consumer group riêng (`realtime-service`) nên nó không tranh message với
 * notification-service — cả hai cùng nhận, mỗi bên làm việc của mình.
 */
@Module({
  providers: [HandshakeAuthService, NotificationGateway],
})
export class RealtimeModule implements OnModuleInit {
  constructor(
    private readonly consumer: EventConsumer,
    private readonly gateway: NotificationGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    this.consumer.on(TOPICS.NOTIFICATION_CREATED, async (payload) => {
      // Đẩy là việc "cố gắng hết sức": người dùng offline thì không ai nhận, và điều đó
      // hoàn toàn bình thường — bản ghi đã nằm trong MongoDB, họ sẽ thấy khi đăng nhập.
      this.gateway.broadcast(payload);
    });

    await this.consumer.start('realtime-service');
  }
}
