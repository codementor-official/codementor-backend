import { InvalidInput, Result, ValueObject } from '@codementor/kernel';

/**
 * Định danh bài tập trong URL công khai. Cột là `citext UNIQUE`, nên hai slug chỉ khác
 * hoa thường vẫn đụng nhau ở CSDL — chuẩn hoá về chữ thường ngay tại đây để lỗi đó
 * không phải chờ tới lúc INSERT mới lộ.
 */
export class Slug extends ValueObject<{ value: string }> {
  private static readonly PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Result<Slug, InvalidInput> {
    const normalized = raw.trim().toLowerCase();
    if (!Slug.PATTERN.test(normalized)) {
      return Result.fail(
        new InvalidInput(
          'Slug phải dài 3–80 ký tự, chỉ gồm chữ thường, số và gạch ngang, không bắt đầu/kết thúc bằng gạch',
          { slug: raw },
        ),
      );
    }
    return Result.ok(new Slug(normalized));
  }

  /**
   * Sinh slug từ tiêu đề. Bỏ dấu tiếng Việt trước khi lọc ký tự — không bỏ thì
   * "Đệ quy" thành "quy", mất luôn từ đầu.
   */
  static fromTitle(title: string, suffix?: string): Result<Slug, InvalidInput> {
    const base = title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70);
    // Tiêu đề toàn ký tự lạ thì base rỗng; vẫn phải ra một slug hợp lệ.
    const stem = base.length >= 3 ? base : `bai-tap-${Date.now().toString(36)}`;
    return Slug.create(suffix ? `${stem}-${suffix}` : stem);
  }

  get value(): string {
    return this.props.value;
  }
}
