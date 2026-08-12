import { Result, InvalidInput } from '@codementor/kernel';
import { ValueObject } from '@codementor/kernel';

/**
 * Định danh xuất hiện trong URL công khai (@giasi).
 * Ràng buộc phải khớp CHECK `users_handle_format` ở CSDL — nếu lệch, insert sẽ bị từ chối
 * bởi Postgres thay vì báo lỗi thân thiện tại đây.
 */
export class Handle extends ValueObject<{ value: string }> {
  private static readonly PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Result<Handle, InvalidInput> {
    const normalized = raw.trim().toLowerCase();
    if (!Handle.PATTERN.test(normalized)) {
      return Result.fail(
        new InvalidInput(
          'Handle phải dài 3–30 ký tự, chỉ gồm chữ thường, số, gạch ngang hoặc gạch dưới, và không bắt đầu/kết thúc bằng gạch',
          { handle: raw },
        ),
      );
    }
    return Result.ok(new Handle(normalized));
  }

  get value(): string {
    return this.props.value;
  }
}
