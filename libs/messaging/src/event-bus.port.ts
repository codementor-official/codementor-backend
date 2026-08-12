import type { TopicName, TopicPayloadMap } from '@codementor/contracts';

export interface PublishOptions {
  /** Xuyên suốt một luồng nghiệp vụ. Nếu bỏ trống sẽ tự sinh — nhưng nên truyền lại từ request. */
  correlationId?: string;
  /** Message nào gây ra message này. */
  causationId?: string;
  actorUserId?: string | null;
}

/**
 * Cổng phát message. Tầng application chỉ biết interface này.
 *
 * Có hai adapter:
 *  - `KafkaEventBus`   phát thẳng lên Kafka. Dùng cho luồng mất message không nguy hiểm.
 *  - `OutboxEventBus`  ghi vào bảng `outbox` TRONG CÙNG transaction với dữ liệu nghiệp vụ,
 *                      một poller đẩy lên Kafka sau. Bắt buộc cho luồng nộp bài.
 *
 * Vì cả hai cùng interface, đổi luồng nào sang outbox chỉ là đổi provider ở module —
 * use case không sửa một dòng.
 */
export interface EventBus {
  publish<T extends TopicName>(
    topic: T,
    payload: TopicPayloadMap[T],
    options?: PublishOptions,
  ): Promise<void>;
}

export const EVENT_BUS = Symbol('EVENT_BUS');

/** Bus ghi qua outbox — inject riêng khi cần đảm bảo không mất message. */
export const OUTBOX_EVENT_BUS = Symbol('OUTBOX_EVENT_BUS');
