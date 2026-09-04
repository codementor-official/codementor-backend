import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PageQuery } from '@codementor/platform';
import { DIFFICULTIES, KINDS, STATUSES } from './exercise.dto';

export class ListExercisesQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: KINDS })
  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @ApiPropertyOptional({ enum: DIFFICULTIES })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: (typeof DIFFICULTIES)[number];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Lọc theo một hoặc nhiều chủ đề. Nhận danh sách phân cách bằng dấu phẩy; bài khớp ít nhất một chủ đề sẽ được trả về.',
  })
  @IsOptional()
  @Transform(({ value }: { value: string | string[] }) => {
    const values = Array.isArray(value) ? value : String(value).split(',');
    return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  })
  @IsArray()
  @IsUUID('4', { each: true })
  topicIds?: string[];

  @ApiPropertyOptional({ enum: ['solved', 'attempted', 'unsolved'] })
  @IsOptional()
  @IsIn(['solved', 'attempted', 'unsolved'])
  progress?: 'solved' | 'attempted' | 'unsolved';

  /** Có tác dụng ở `/mine` và `/moderation`; kho chung theo định nghĩa chỉ có bài `published`. */
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional({ description: 'Lọc theo tác giả (trang quản trị)' })
  @IsOptional()
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional({ description: 'Cập nhật từ ngày này (ISO 8601), trang quản trị' })
  @IsOptional()
  @IsDateString()
  updatedFrom?: string;

  @ApiPropertyOptional({ description: 'Cập nhật tới ngày này (ISO 8601), trang quản trị' })
  @IsOptional()
  @IsDateString()
  updatedTo?: string;
}
