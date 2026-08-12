import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@codementor/platform';
import type { TopicName, TopicPayloadMap } from '@codementor/contracts';
import { buildEnvelope, partitionKeyOf } from './kafka-event-bus';
import { KafkaClient } from './kafka.client';
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options';
import type { EventBus, PublishOptions } from './event-bus.port';

/**
 * Transactional outbox.
 *
 * Vấn đề: `INSERT submissions` rồi `kafka.send()` là hai thao tác trên hai hệ thống.
 * Tiến trình chết ở giữa → bài nộp nằm trong DB mà lệnh chấm không bao giờ được phát,
 * người dùng thấy bài treo mãi ở trạng thái pending.
 *
 * Cách xử lý: ghi message vào bảng `outbox` TRONG CÙNG transaction với dữ liệu nghiệp vụ.
 * Hoặc cả hai cùng commit, hoặc cả hai cùng rollback. Poller đọc và đẩy lên Kafka sau.
 *
 * Đánh đổi: message đến chậm hơn (tối đa một chu kỳ poll) và có thể phát trùng khi
 * poller chết sau send nhưng trước khi đánh dấu — nên consumer BẮT BUỘC idempotent
 * theo `eventId`.
 */
@Injectable()
export class OutboxEventBus implements EventBus {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
  ) {}

  /**
   * Gọi bên trong `prisma.$transaction` cùng với lệnh ghi nghiệp vụ để có đảm bảo nguyên tử.
   * Gọi ngoài transaction thì vẫn chạy, nhưng mất đúng thứ mà outbox sinh ra để giải quyết.
   */
  async publish<T extends TopicName>(
    topic: T,
    payload: TopicPayloadMap[T],
    options: PublishOptions = {},
  ): Promise<void> {
    const envelope = buildEnvelope(topic, payload, this.options.serviceName, options);
    await this.prisma.$executeRaw`
      INSERT INTO outbox (id, topic, partition_key, payload)
      VALUES (
        ${envelope.eventId}::uuid,
        ${topic},
        ${partitionKeyOf(topic, payload)},
        ${JSON.stringify(envelope)}::jsonb
      )`;
  }
}

interface OutboxRow {
  id: string;
  topic: string;
  partition_key: string | null;
  payload: unknown;
}

/**
 * Đẩy message chưa gửi từ `outbox` lên Kafka.
 *
 * `FOR UPDATE SKIP LOCKED` cho phép chạy nhiều instance cùng lúc mà không giành nhau
 * cùng một hàng — cần thiết vì service sẽ chạy nhiều bản khi scale.
 */
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  private static readonly INTERVAL_MS = 1000;
  private static readonly BATCH_SIZE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaClient,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.enableOutbox) return;
    this.timer = setInterval(() => void this.drain(), OutboxPublisher.INTERVAL_MS);
    this.logger.log('Outbox publisher đã bật');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public để test gọi trực tiếp thay vì phải chờ timer. */
  async drain(): Promise<number> {
    if (this.running) return 0; // tránh chồng lượt khi Kafka chậm
    this.running = true;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, topic, partition_key, payload
          FROM outbox
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT ${OutboxPublisher.BATCH_SIZE}
          FOR UPDATE SKIP LOCKED`;

        if (rows.length === 0) return 0;

        await this.kafka.producer.sendBatch({
          topicMessages: groupByTopic(rows),
        });

        await tx.$executeRaw`
          UPDATE outbox SET published_at = now()
          WHERE id = ANY(${rows.map((r) => r.id)}::uuid[])`;

        this.logger.debug(`outbox -> Kafka: ${rows.length} message`);
        return rows.length;
      });
    } catch (error) {
      // Không ném ra: lần poll sau sẽ thử lại. Message vẫn nằm nguyên trong outbox.
      this.logger.error('Đẩy outbox thất bại, sẽ thử lại', error as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }
}

function groupByTopic(rows: OutboxRow[]) {
  const byTopic = new Map<string, { key: string | null; value: string }[]>();
  for (const row of rows) {
    const list = byTopic.get(row.topic) ?? [];
    list.push({ key: row.partition_key, value: JSON.stringify(row.payload) });
    byTopic.set(row.topic, list);
  }
  return [...byTopic].map(([topic, messages]) => ({ topic, messages }));
}
