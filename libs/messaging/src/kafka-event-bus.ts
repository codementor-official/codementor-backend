import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PARTITION_KEY,
  type EventEnvelope,
  type TopicName,
  type TopicPayloadMap,
} from '@codementor/contracts';
import { KafkaClient } from './kafka.client';
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options';
import type { EventBus, PublishOptions } from './event-bus.port';

/** Phát thẳng lên Kafka. Có thể mất message nếu tiến trình chết ngay sau khi commit DB. */
@Injectable()
export class KafkaEventBus implements EventBus {
  private readonly logger = new Logger(KafkaEventBus.name);

  constructor(
    private readonly kafka: KafkaClient,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
  ) {}

  async publish<T extends TopicName>(
    topic: T,
    payload: TopicPayloadMap[T],
    options: PublishOptions = {},
  ): Promise<void> {
    const envelope = buildEnvelope(topic, payload, this.options.serviceName, options);
    await this.kafka.producer.send({
      topic,
      messages: [{ key: partitionKeyOf(topic, payload), value: JSON.stringify(envelope) }],
    });
    this.logger.debug(`-> ${topic} (${envelope.eventId})`);
  }
}

export function buildEnvelope<T extends TopicName>(
  topic: T,
  payload: TopicPayloadMap[T],
  producer: string,
  options: PublishOptions,
): EventEnvelope<TopicPayloadMap[T]> {
  return {
    eventId: randomUUID(),
    eventName: topic,
    occurredAt: new Date().toISOString(),
    correlationId: options.correlationId ?? randomUUID(),
    causationId: options.causationId,
    actor: { userId: options.actorUserId ?? null },
    producer,
    payload,
  };
}

/**
 * Lấy giá trị làm partition key theo cấu hình ở contracts.
 * Thiếu trường thì trả null — Kafka sẽ phân phối round-robin và MẤT đảm bảo thứ tự,
 * nên cảnh báo để phát hiện sớm thay vì im lặng chạy sai.
 */
export function partitionKeyOf<T extends TopicName>(
  topic: T,
  payload: TopicPayloadMap[T],
): string | null {
  const field = PARTITION_KEY[topic];
  const value = (payload as unknown as Record<string, unknown>)[field];
  if (typeof value === 'string') return value;
  new Logger('partitionKeyOf').warn(
    `Topic ${topic} thiếu trường "${field}" để làm partition key — mất đảm bảo thứ tự`,
  );
  return null;
}
