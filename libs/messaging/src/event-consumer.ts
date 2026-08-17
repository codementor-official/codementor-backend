import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import type { EventEnvelope, TopicName, TopicPayloadMap } from '@codementor/contracts';
import { KafkaClient } from './kafka.client';

export type EventHandler<T extends TopicName> = (
  payload: TopicPayloadMap[T],
  envelope: EventEnvelope<TopicPayloadMap[T]>,
) => Promise<void>;

/**
 * Đăng ký handler cho topic, kèm khử trùng lặp.
 *
 * Kafka đảm bảo **at-least-once**: cùng một message có thể được giao lại khi consumer
 * restart, rebalance, hoặc commit offset thất bại. Không khử trùng thì "cộng 50 XP"
 * chạy hai lần là chuyện sớm muộn.
 *
 * Chống trùng bằng bảng `processed_events` với khoá chính (consumer, event_id):
 * ghi trùng sẽ vi phạm PK → bỏ qua message.
 */
@Injectable()
export class EventConsumer implements OnModuleDestroy {
  private readonly logger = new Logger(EventConsumer.name);
  private readonly registrations: { topic: TopicName; handler: EventHandler<TopicName> }[] = [];
  private started = false;

  constructor(
    private readonly kafka: KafkaClient,
    private readonly prisma: PrismaService,
  ) {}

  /** Gọi trong onModuleInit của từng service. */
  on<T extends TopicName>(topic: T, handler: EventHandler<T>): this {
    this.registrations.push({
      topic,
      handler: handler as EventHandler<TopicName>,
    });
    return this;
  }

  async start(consumerName: string): Promise<void> {
    if (this.started || this.registrations.length === 0) return;
    this.started = true;

    // Trước khi subscribe: topic chưa từng được phát lần nào vẫn phải tồn tại, nếu không
    // kafkajs ném UNKNOWN_TOPIC_OR_PARTITION ngay trong onModuleInit và service chết.
    await this.kafka.ensureTopics(this.registrations.map((r) => r.topic));

    const consumer = this.kafka.createConsumer();
    await consumer.connect();

    for (const { topic } of this.registrations) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;

        const envelope = JSON.parse(message.value.toString()) as EventEnvelope;
        const handled = this.registrations.filter((r) => r.topic === topic);

        for (const { handler } of handled) {
          const isNew = await this.markProcessed(consumerName, envelope.eventId, topic);
          if (!isNew) {
            this.logger.debug(`bỏ qua ${topic} (${envelope.eventId}) — đã xử lý`);
            continue;
          }
          try {
            await handler(envelope.payload as never, envelope as never);
          } catch (error) {
            // Nhả dấu đã-xử-lý để lần giao lại còn chạy được.
            await this.unmarkProcessed(consumerName, envelope.eventId);
            this.logger.error(
              `xử lý ${topic} thất bại (correlationId=${envelope.correlationId})`,
              error as Error,
            );
            throw error; // kafkajs sẽ retry theo cấu hình
          }
        }
      },
    });

    this.logger.log(
      `đang nghe: ${[...new Set(this.registrations.map((r) => r.topic))].join(', ')}`,
    );
  }

  onModuleDestroy(): void {
    this.started = false;
  }

  /** true nếu đây là lần đầu thấy event này. */
  private async markProcessed(consumer: string, eventId: string, topic: string): Promise<boolean> {
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO processed_events (consumer, event_id, topic)
      VALUES (${consumer}, ${eventId}::uuid, ${topic})
      ON CONFLICT (consumer, event_id) DO NOTHING`;
    return inserted > 0;
  }

  private async unmarkProcessed(consumer: string, eventId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM processed_events WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid`;
  }
}
