import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '@codementor/platform';

/** Ba trạng thái bài viết thực sự dùng — xem ghi chú ở `Article`. */
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;

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

/** Bốn nhánh giống hệt kiểm duyệt khoá học và lộ trình. */
export const MODERATION_DECISIONS = ['approve', 'request_changes', 'reject', 'archive'] as const;

export class ModerateArticleDto {
  @ApiProperty({ enum: MODERATION_DECISIONS })
  @IsIn([...MODERATION_DECISIONS])
  decision!: (typeof MODERATION_DECISIONS)[number];

  @ApiPropertyOptional({ description: 'Bắt buộc khi từ chối hoặc yêu cầu sửa' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
