/**
 * Kết quả có thể thất bại mà không cần ném exception.
 *
 * Dùng ở tầng domain/application để lỗi nghiệp vụ là *giá trị trả về* chứ không phải
 * luồng ngoại lệ — nhờ đó use case không phụ thuộc cơ chế exception của framework.
 * Chỉ tầng presentation mới dịch `Result` thất bại thành HTTP status.
 */
export class Result<T, E = Error> {
  private constructor(
    private readonly _ok: boolean,
    private readonly _value?: T,
    private readonly _error?: E,
  ) {}

  static ok<T, E = Error>(value: T): Result<T, E> {
    return new Result<T, E>(true, value, undefined);
  }

  static fail<T, E = Error>(error: E): Result<T, E> {
    return new Result<T, E>(false, undefined, error);
  }

  get isOk(): boolean {
    return this._ok;
  }

  get isFail(): boolean {
    return !this._ok;
  }

  /** Ném nếu gọi trên kết quả thất bại — luôn kiểm tra `isOk` trước. */
  get value(): T {
    if (!this._ok) {
      throw new Error('Không thể đọc value của một Result thất bại');
    }
    return this._value as T;
  }

  get error(): E {
    if (this._ok) {
      throw new Error('Không thể đọc error của một Result thành công');
    }
    return this._error as E;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return this._ok ? Result.ok<U, E>(fn(this._value as T)) : Result.fail<U, E>(this._error as E);
  }

  /** Gộp nhiều Result: trả về lỗi đầu tiên gặp phải, hoặc mảng giá trị. */
  static combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
    const values: T[] = [];
    for (const r of results) {
      if (r.isFail) return Result.fail<T[], E>(r.error);
      values.push(r.value);
    }
    return Result.ok<T[], E>(values);
  }
}
