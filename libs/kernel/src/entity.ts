/** Định danh bằng id, không bằng giá trị thuộc tính. */
export abstract class Entity<TId = string> {
  protected constructor(readonly id: TId) {}

  equals(other?: Entity<TId>): boolean {
    if (other === null || other === undefined) return false;
    if (this === other) return true;
    return this.id === other.id;
  }
}
