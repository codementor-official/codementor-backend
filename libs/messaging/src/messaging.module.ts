import { Global, Module, type DynamicModule } from '@nestjs/common';
import { PrismaModule } from '@codementor/platform';
import { EVENT_BUS, OUTBOX_EVENT_BUS } from './event-bus.port';
import { EventConsumer } from './event-consumer';
import { KafkaEventBus } from './kafka-event-bus';
import { KafkaClient } from './kafka.client';
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options';
import { OutboxEventBus, OutboxPublisher } from './outbox';

/**
 * Mỗi service gọi `MessagingModule.forRoot({ serviceName: '...' })`.
 *
 * Service nào cần đảm bảo không mất message (submission) thì bật `enableOutbox: true`
 * và inject `OUTBOX_EVENT_BUS` thay vì `EVENT_BUS`.
 */
@Global()
@Module({})
export class MessagingModule {
  static forRoot(options: MessagingOptions): DynamicModule {
    return {
      module: MessagingModule,
      // EventConsumer và OutboxPublisher ghi `processed_events`/`outbox` qua Prisma.
      // Import ở đây thay vì trông chờ từng service nhớ thêm PrismaModule.
      imports: [PrismaModule],
      providers: [
        { provide: MESSAGING_OPTIONS, useValue: options },
        KafkaClient,
        EventConsumer,
        { provide: EVENT_BUS, useClass: KafkaEventBus },
        { provide: OUTBOX_EVENT_BUS, useClass: OutboxEventBus },
        OutboxPublisher,
      ],
      exports: [EVENT_BUS, OUTBOX_EVENT_BUS, EventConsumer, KafkaClient],
    };
  }
}
