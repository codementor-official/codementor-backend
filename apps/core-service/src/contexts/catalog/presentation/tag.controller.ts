import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InvalidInput } from '@codementor/kernel';
import { PrismaService, Roles } from '@codementor/platform';

interface TagRow {
  id: string;
  slug: string;
  name: string;
  category: string;
}

const TAG_CATEGORIES = [
  'algorithms',
  'database',
  'web',
  'systems',
  'data_ai',
  'foundations',
  'other',
] as const;

class CreateTagDto {
  @ApiProperty({ example: 'Quy hoạch động' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ enum: TAG_CATEGORIES, required: false, default: 'other' })
  @IsOptional()
  @IsIn(TAG_CATEGORIES)
  category?: (typeof TAG_CATEGORIES)[number];
}

/**
 * Slug sinh từ tên, bỏ dấu trước khi lọc ký tự — không bỏ thì "Đệ quy" rụng còn "quy".
 *
 * Bản rút gọn của `Slug.fromTitle` bên exercise-service. Không import qua: đó là value
 * object của một aggregate ở service khác, và `docs/02-service-architecture.md §5` cấm
 * apps kéo code của nhau.
 */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

/**
 * Từ vựng chủ đề dùng chung (`tags`), do core-service sở hữu.
 *
 * Khác `GET /articles/tags` bên learning-service: đường đó trả các chủ đề ĐÃ CÓ bài công
 * khai kèm số bài, dành cho dãy chip lọc của người đọc. Đường này trả TOÀN BỘ chủ đề kèm
 * `id`, dành cho ô chọn lúc soạn bài — chủ đề chưa có bài nào vẫn phải chọn được, nếu
 * không thì không bài nào gắn được chủ đề mới.
 *
 * Không dựng repository/use case cho một câu SELECT không tham số trên bảng chỉ vài chục
 * hàng: chưa có luật nghiệp vụ nào để đặt vào đó.
 */
@ApiTags('tags')
@ApiBearerAuth('access-token')
@Controller({ path: 'tags', version: '1' })
export class TagController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Toàn bộ chủ đề, xếp theo tên' })
  list(): Promise<TagRow[]> {
    return this.prisma.$queryRaw<TagRow[]>`
      SELECT id, slug, name, category FROM tags ORDER BY name`;
  }

  /**
   * Thêm chủ đề mới.
   *
   * Trùng slug thì TRẢ VỀ cái đã có thay vì 409: người soạn gõ "Đệ quy" không cần biết
   * ai đó đã tạo nó trước, họ chỉ cần gắn được chủ đề đó vào bài. Không có đường sửa hay
   * xoá — từ vựng dùng chung mà ai cũng đổi tên được thì mọi thứ đã gắn đều lệch nghĩa.
   */
  @Post()
  @Roles('admin', 'lecturer')
  @ApiOperation({ summary: 'Thêm chủ đề; trùng tên thì trả về chủ đề đã có' })
  async create(@Body() dto: CreateTagDto): Promise<TagRow> {
    const name = dto.name.trim();
    const slug = slugify(name);
    if (slug.length < 2) {
      throw new InvalidInput('Tên chủ đề phải có ít nhất hai ký tự chữ hoặc số', { name });
    }

    const rows = await this.prisma.$queryRaw<TagRow[]>`
      INSERT INTO tags (slug, name, category)
      VALUES (${slug}::citext, ${name}, ${dto.category ?? 'other'})
      ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
      RETURNING id, slug, name, category`;
    return rows[0];
  }
}
