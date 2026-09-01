import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IMAGE_CONTENT_TYPES, PageQuery } from '@codementor/platform';
import { DECISIONS } from './moderate.dto';

/**
 * Đủ SÁU giá trị của `content_status`, không phải ba.
 *
 * Danh sách này từng là `['draft', 'published', 'archived']`, đúng vào thời điểm bài viết
 * do admin tự soạn tự đăng và không đi qua hàng chờ duyệt nào. Điều đó đã đổi — `Article`
 * giờ có `submit()`, `moderate()` và đủ máy trạng thái như khoá học — nhưng danh sách ở
 * tầng DTO thì không đổi theo, nên `?status=rejected` bị chặn ngay ở validator với 400.
 *
 * Hệ quả nhìn thấy được: khay "Đã từ chối" bên hàng chờ duyệt tải được bài code, khoá học,
 * lộ trình, và báo "Không tải được: Bài viết" — một loại nội dung hỏng giữa bốn loại giống
 * hệt nhau, vì đúng một danh sách hằng bị bỏ quên lại phía sau.
 */
export const ARTICLE_STATUSES = [
  'draft',
  'pending_review',
  'changes_requested',
  'rejected',
  'published',
  'archived',
] as const;

export class ListArticlesQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: ARTICLE_STATUSES })
  @IsOptional()
  @IsIn([...ARTICLE_STATUSES])
  status?: (typeof ARTICLE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Lọc theo tên chủ đề' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tag?: string;
}

export class CreateArticleDto {
  @ApiProperty({ example: '5 kỹ thuật giúp bạn học Spring Boot hiệu quả hơn' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Bỏ trống để sinh từ tiêu đề' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;
}

export class UpdateArticleDto {
  @ApiPropertyOptional({ description: 'Chỉ đổi được khi bài chưa từng công khai' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Bắt buộc có mới đăng được bài' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  takeaway?: string;

  @ApiPropertyOptional({ description: 'Ảnh bìa bài viết từ kho đối tượng hoặc URL HTTPS' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  coverImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readMinutes?: number;
}

export class ArticleCoverUploadUrlDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: IMAGE_CONTENT_TYPES })
  @IsIn([...IMAGE_CONTENT_TYPES])
  contentType!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class SaveArticleContentDto {
  /**
   * HTML từ RichTextEditor. Không kiểm cấu trúc ở đây: nó là tài liệu do người soạn tạo
   * ra, và trình soạn thảo mới là nơi quyết định thẻ nào hợp lệ.
   */
  @ApiProperty({ example: '<h2>Mở đầu</h2><p>Nội dung…</p>' })
  @IsString()
  @MaxLength(200_000)
  contentHtml!: string;
}

/**
 * Cùng danh sách mà khoá học và lộ trình dùng — LẤY LẠI, không chép.
 *
 * Đây từng là một mảng riêng nằm ngay tại đây, và nó đã bỏ lỡ nhánh `revert`: bài viết là
 * loại nội dung duy nhất trong bốn loại không hoàn tác được, vì đúng một hằng số bị chép
 * ra thành hai bản rồi hai bản trôi khỏi nhau. Cùng đúng hình dạng lỗi mà danh sách kiểu
 * bài học đã gây ra ("Tạo khóa học không có VIDEO nhưng Sửa thì có").
 *
 * Giữ lại tên cũ để không phải sửa nơi gọi, nhưng giá trị chỉ có một nguồn.
 */
export { DECISIONS as MODERATION_DECISIONS } from './moderate.dto';

export class ModerateArticleDto {
  @ApiProperty({ enum: DECISIONS })
  @IsIn([...DECISIONS])
  decision!: (typeof DECISIONS)[number];

  @ApiPropertyOptional({ description: 'Bắt buộc khi từ chối hoặc yêu cầu sửa' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
