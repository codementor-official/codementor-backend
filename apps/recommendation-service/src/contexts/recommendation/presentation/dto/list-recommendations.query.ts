import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * KHÔNG có `userId` ở đây, và sẽ không bao giờ có: danh tính chỉ đến từ token đã xác thực.
 * Nhận `userId` từ query nghĩa là ai cũng xem được đề xuất — tức là hồ sơ học tập — của
 * người khác.
 */
export class ListRecommendationsQuery {
  @ApiPropertyOptional({ default: 6, maximum: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  limit?: number;
}

export class NextExerciseQuery {
  @ApiProperty({ description: 'Bài vừa giải xong — sẽ bị loại khỏi kết quả' })
  @IsUUID()
  exerciseId!: string;
}
