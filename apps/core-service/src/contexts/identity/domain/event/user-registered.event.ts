import { DomainEvent } from '@codementor/kernel';

/**
 * Context khác lắng nghe sự kiện này thay vì Identity gọi thẳng sang chúng.
 * Ví dụ: Learning tạo bản ghi preference mặc định, Notification gửi email xác thực.
 */
export class UserRegistered extends DomainEvent {
  readonly eventName = 'identity.user.registered';

  constructor(
    readonly aggregateId: string,
    readonly email: string,
    readonly displayName: string,
  ) {
    super();
  }
}
