import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, type Consumer, type Producer } from 'kafkajs';
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options';

/**
 * Kết nối Kafka dùng chung cho producer và consumer của một service.
 *
 * `clientId` và `groupId` đều lấy theo tên service, nên xem trong Kafka UI là biết ngay
 * ai đang đọc ghi cái gì.
 */
@Injectable()
export class KafkaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaClient.name);
  private readonly kafka: Kafka;
  readonly producer: Producer;
  private readonly consumers: Consumer[] = [];

  constructor(
    config: ConfigService,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
  ) {
    this.kafka = new Kafka({
      clientId: options.serviceName,
      brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 8 },
    });
    this.producer = this.kafka.producer({
      // Chờ mọi replica xác nhận. Chậm hơn một chút nhưng không mất message khi broker chết.
      idempotent: true,
      maxInFlightRequests: 1,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log(`Kafka producer đã kết nối (${this.options.serviceName})`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.producer.disconnect(),
      ...this.consumers.map((c) => c.disconnect()),
    ]);
  }

  /**
   * Tạo consumer. Mỗi service dùng consumer group riêng theo tên service, nên nhiều
   * service cùng nghe một topic sẽ đều nhận được message (fan-out), còn nhiều instance
   * của CÙNG một service thì chia nhau (load balancing).
   */
  createConsumer(groupSuffix?: string): Consumer {
    const groupId = groupSuffix
      ? `${this.options.serviceName}.${groupSuffix}`
      : this.options.serviceName;
    const consumer = this.kafka.consumer({ groupId, sessionTimeout: 30000 });
    this.consumers.push(consumer);
    return consumer;
  }
}
