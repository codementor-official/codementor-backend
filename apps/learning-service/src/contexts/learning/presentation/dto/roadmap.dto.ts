import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '@codementor/platform';

export const FIELDS = ['frontend', 'backend', 'fullstack', 'mobile', 'data_ai', 'foundation'] as const;
export const LEVELS = ['none', 'basic', 'intermediate', 'experienced'] as const;
export const MODES = ['linear', 'graph', 'free'] as const;
export const CONTENT_STATUSES = [
  'draft',
  'pending_review',
  'changes_requested',
  'rejected',
  'published',
  'archived',
] as const;

export class CreateRoadmapDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: FIELDS })
  @IsIn(FIELDS)
  field!: (typeof FIELDS)[number];

  @ApiProperty({ enum: LEVELS })
  @IsIn(LEVELS)
  level!: (typeof LEVELS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;
}

/** Không có `estimatedHours`: nó là tổng của khóa học con, app tự tính. */
export class UpdateRoadmapDto {
  @ApiPropertyOptional({ description: 'Chỉ đổi được khi chưa công khai' })
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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  shortDescription?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ enum: FIELDS })
  @IsOptional()
  @IsIn(FIELDS)
  field?: (typeof FIELDS)[number];

  @ApiPropertyOptional({ enum: LEVELS })
  @IsOptional()
  @IsIn(LEVELS)
  level?: (typeof LEVELS)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  coverImageUrl?: string | null;

  @ApiPropertyOptional({ enum: MODES })
  @IsOptional()
  @IsIn(MODES)
  progressionMode?: (typeof MODES)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  prerequisiteNote?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Thay TOÀN BỘ danh sách chủ đề. Mảng rỗng gỡ hết; vắng mặt giữ nguyên.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];

}

class RoadmapCourseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}

/**
 * Thứ tự lấy theo thứ tự phần tử trong mảng, không nhận `position` từ client — client
 * gửi vị trí lệch nhau là đụng `UNIQUE(roadmap_id, position)`.
 */
export class ReplaceRoadmapCoursesDto {
  @ApiProperty({ type: [RoadmapCourseDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RoadmapCourseDto)
  courses!: RoadmapCourseDto[];
}

export class ListRoadmapsQueryDto extends PageQuery {
  @ApiPropertyOptional({ enum: FIELDS })
  @IsOptional()
  @IsIn(FIELDS)
  field?: (typeof FIELDS)[number];

  @ApiPropertyOptional({ enum: LEVELS })
  @IsOptional()
  @IsIn(LEVELS)
  level?: (typeof LEVELS)[number];

  @ApiPropertyOptional({ enum: CONTENT_STATUSES })
  @IsOptional()
  @IsIn(CONTENT_STATUSES)
  status?: (typeof CONTENT_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Lọc theo giảng viên đứng tên (trang quản trị)' })
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
