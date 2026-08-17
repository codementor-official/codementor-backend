import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@codementor/platform';

interface TagRow {
  id: string;
  slug: string;
  name: string;
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
      SELECT id, slug, name FROM tags ORDER BY name`;
  }
}
