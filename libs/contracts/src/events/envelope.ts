/**
 * Vỏ chung của MỌI message trên Kafka.
 *
 * Đặt ở `libs/contracts` vì đây là thứ duy nhất các service được phép chia sẻ kiểu dữ liệu.
 * Không bao giờ đưa entity hay repository vào đây.
 */
export interface EventEnvelope<TPayload = unknown> {
  /** Khoá idempotency. Kafka đảm bảo at-least-once nên consumer PHẢI chịu được message trùng. */
  eventId: string;

  /** Tên đầy đủ kèm version, vd evt.judge.completed.v1 */
  eventName: string;

  occurredAt: string;

  /** Xuyên suốt một luồng nghiệp vụ: nộp bài -> chấm -> cộng XP đều cùng correlationId. */
  correlationId: string;

  /** Message nào sinh ra message này - dựng lại được cây nhân quả khi debug. */
  causationId?: string;

  /** Ai kích hoạt. null với tác vụ do hệ thống tự chạy. */
  actor?: { userId: string | null };

  /** Service phát ra message - hữu ích khi truy vết producer sai. */
  producer: string;

  payload: TPayload;
}
