/**
 * Định danh bằng giá trị, bất biến. So sánh bằng cách so sánh toàn bộ props.
 * Value object tự validate trong factory và không bao giờ ở trạng thái không hợp lệ.
 */
export abstract class ValueObject<T extends Record<string, unknown>> {
  protected constructor(protected readonly props: T) {
    Object.freeze(this.props);
  }

  equals(other?: ValueObject<T>): boolean {
    if (other === null || other === undefined) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}
