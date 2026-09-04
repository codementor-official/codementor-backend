import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery, VIDEO_CONTENT_TYPES } from '@codementor/platform';
import { LESSON_TYPES } from '../../domain/model/curriculum';
import { CONTENT_STATUSES, LEVELS, MODES } from './roadmap.dto';

export class CreateCourseDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: LEVELS })
  @IsIn(LEVELS)
  level!: (typeof LEVELS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;
}

/** Không có `durationHours`: tổng của bài học, app tự tính sau mỗi lần ghi curriculum. */
export class UpdateCourseDto {
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
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  coverImageUrl?: string | null;

  @ApiPropertyOptional({ enum: LEVELS })
  @IsOptional()
  @IsIn(LEVELS)
  level?: (typeof LEVELS)[number];

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  instructorId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  prerequisiteNote?: string | null;

  @ApiPropertyOptional({ enum: MODES })
  @IsOptional()
  @IsIn(MODES)
  progressionMode?: (typeof MODES)[number];

  @ApiPropertyOptional({
    type: [String],
    description: 'Thay TOÀN BỘ danh sách chủ đề. Mảng rỗng gỡ hết; vắng mặt giữ nguyên.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];
}

class LessonDraftDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Có = bài đã tồn tại, giữ nguyên tiến độ' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: LESSON_TYPES })
  @IsIn(LESSON_TYPES)
  type!: (typeof LESSON_TYPES)[number];

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  durationMinutes?: number | null;

  /**
   * "Cho học trước": mở cho MỌI người kể cả chưa ghi danh, và bỏ qua yêu cầu bài/chương
   * liền trước. Server tự suy cạnh phụ thuộc từ thứ tự chương/bài cho các bài không mang
   * cờ này — xem `deriveLessonSources`.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPreview?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  exerciseId?: string | null;
}

class ChapterDraftDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @ApiProperty({ type: [LessonDraftDto] })
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => LessonDraftDto)
  lessons!: LessonDraftDto[];
}

/** Thứ tự lấy theo thứ tự mảng; client không gửi `position`. */
export class SaveCurriculumDto {
  @ApiProperty({ type: [ChapterDraftDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ChapterDraftDto)
  chapters!: ChapterDraftDto[];
}

/** Video của bài học. Xem `LessonContent.media` để biết vì sao không có `provider`. */
class LessonMediaDto {
  @ApiProperty({ description: 'URL video: tệp trực tiếp, YouTube hoặc Vimeo' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  captionsUrl?: string;
}

/** Xin một URL ký sẵn để trình duyệt `PUT` thẳng video lên kho — xem `ObjectStorageService`. */
export class VideoUploadUrlDto {
  @ApiProperty({ description: 'Chỉ phần đuôi được giữ lại làm tên đối tượng' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: VIDEO_CONTENT_TYPES })
  @IsIn(VIDEO_CONTENT_TYPES)
  contentType!: (typeof VIDEO_CONTENT_TYPES)[number];

  @ApiProperty({ minimum: 1, description: 'Nằm trong chữ ký, nên phải khớp tệp thật' })
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class SaveLessonContentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  objectives?: string[];

  @ApiPropertyOptional({ description: 'HTML từ TipTap' })
  @IsOptional()
  @IsString()
  contentHtml?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exerciseBrief?: string[];

  @ApiPropertyOptional({ type: LessonMediaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LessonMediaDto)
  media?: LessonMediaDto;
}

export class ListCoursesQueryDto extends PageQuery {
  @ApiPropertyOptional({
    description: 'Up to 20 comma-separated course UUIDs; existing visibility rules still apply',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Lọc theo ít nhất một chủ đề.' })
  @IsOptional()
  @Transform(({ value }) => {
    const values = Array.isArray(value) ? value : String(value).split(',');
    return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  })
  @IsArray()
  @IsUUID('4', { each: true })
  topicIds?: string[];

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
