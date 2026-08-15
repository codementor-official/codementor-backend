import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phân trang bằng cursor, không dùng offset.
 *
 * Danh sách nội dung sắp theo `updated_at desc` và thay đổi liên tục khi giảng viên
 * đang soạn. Với offset, một bản ghi vừa được sửa nhảy lên đầu sẽ đẩy mọi thứ xuống
 * một dòng — người dùng lật sang trang 2 sẽ thấy lại bản ghi cuối của trang 1, hoặc
 * mất hẳn một bản ghi. Cursor trỏ vào một hàng cụ thể nên không bị.
 */
export class PageQuery {
  @ApiPropertyOptional({ description: 'Cursor lấy từ `nextCursor` của trang trước' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Tìm theo tiêu đề, không phân biệt hoa thường' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class Page<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiPropertyOptional({ nullable: true, description: 'null = đã hết' })
  nextCursor!: string | null;
}

export const DEFAULT_PAGE_LIMIT = 20;

/**
 * Cursor mã hoá cặp khoá sắp xếp `(updated_at, id)`. Cần cả hai: `updated_at` một mình
 * không phải khoá duy nhất, hai bản ghi cùng mili-giây sẽ khiến trang sau bỏ sót.
 *
 * Base64url chỉ để cursor không trông như thứ gọi được sửa tay — không phải bảo mật,
 * nội dung bên trong không có gì bí mật.
 */
export function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { updatedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const updatedAt = new Date(iso ?? '');
    if (!id || Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

/**
 * Cắt mảng đã lấy dư một hàng thành một trang.
 * Truy vấn phải lấy `limit + 1` hàng: hàng dư là cách duy nhất biết còn trang sau
 * mà không phải chạy thêm một câu COUNT.
 */
export function toPage<T extends { id: string; updatedAt: Date }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}
