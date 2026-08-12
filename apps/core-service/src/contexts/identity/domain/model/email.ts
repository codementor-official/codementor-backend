import { Result, InvalidInput } from '@codementor/kernel';
import { ValueObject } from '@codementor/kernel';

/**
 * Email đã chuẩn hoá. CSDL dùng kiểu `citext` nên so sánh không phân biệt hoa thường;
 * ta hạ về chữ thường ngay tại biên để hai tầng không bao giờ lệch nhau.
 */
export class Email extends ValueObject<{ value: string }> {
  private static readonly PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Result<Email, InvalidInput> {
    const normalized = raw.trim().toLowerCase();
    if (!Email.PATTERN.test(normalized)) {
      return Result.fail(new InvalidInput('Email không hợp lệ', { email: raw }));
    }
    return Result.ok(new Email(normalized));
  }

  get value(): string {
    return this.props.value;
  }

  toString(): string {
    return this.props.value;
  }
}
