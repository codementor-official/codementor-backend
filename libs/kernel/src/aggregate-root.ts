import { Entity } from './entity';
import type { DomainEvent } from './domain-event';

/**
 * Gốc của một aggregate — ranh giới nhất quán. Mọi thay đổi đi qua đây.
 *
 * Sự kiện được *tích luỹ* trong aggregate và chỉ phát ra SAU KHI lưu thành công
 * (xem `EventBus.publishAll` gọi ở tầng application), tránh trường hợp handler chạy
 * trong khi transaction còn có thể rollback.
 */
export abstract class AggregateRoot<TId = string> extends Entity<TId> {
  private _events: DomainEvent[] = [];

  protected addEvent(event: DomainEvent): void {
    this._events.push(event);
  }

  /** Lấy sự kiện và xoá khỏi aggregate — gọi một lần sau khi persist. */
  pullEvents(): DomainEvent[] {
    const events = this._events;
    this._events = [];
    return events;
  }

  get hasEvents(): boolean {
    return this._events.length > 0;
  }
}
