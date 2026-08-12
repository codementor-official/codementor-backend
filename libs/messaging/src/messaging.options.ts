export interface MessagingOptions {
  /** Tên service — dùng làm Kafka clientId và consumer group. */
  serviceName: string;
  /** Bật poller đẩy outbox lên Kafka. Chỉ service nào ghi outbox mới cần. */
  enableOutbox?: boolean;
}

export const MESSAGING_OPTIONS = Symbol('MESSAGING_OPTIONS');
