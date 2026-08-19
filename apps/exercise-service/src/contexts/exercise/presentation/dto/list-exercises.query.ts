import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
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
