/**
 * Sự kiện domain — cách DUY NHẤT một context được tác động lên dữ liệu của context khác.
 *
 * Ví dụ: Submission không được ghi thẳng vào `exercise_progress` (Exercise sở hữu) hay
 * `user_stats` (Identity sở hữu). Nó phát `submission.accepted`, hai context kia tự xử lý.
 * Khi tách microservice, chỉ thay adapter của EventBus — handler giữ nguyên.
 */
export abstract class DomainEvent {
  /** Tên dạng `<context>.<sự-việc-đã-xảy-ra>`, quá khứ. Là hợp đồng giữa các context. */
  abstract readonly eventName: string;

  readonly occurredAt: Date = new Date();

  /** Id của aggregate phát sinh sự kiện — phục vụ truy vết. */
  abstract readonly aggregateId: string;
}
