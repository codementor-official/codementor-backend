import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export const PROGRESS_STATUSES = ['not_started', 'in_progress', 'completed'] as const;

export class EnrollDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Lộ trình mà người học đi vào khóa này từ đó — chỉ để thống kê đường vào.',
  })
  @IsOptional()
  @IsUUID()
  viaRoadmapId?: string;
}

export class RecordProgressDto {
  @ApiProperty({ enum: PROGRESS_STATUSES })
  @IsIn(PROGRESS_STATUSES)
  status!: (typeof PROGRESS_STATUSES)[number];

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Thời gian của PHIÊN này, không phải tổng — server cộng dồn.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  // Một phiên dài hơn 12 tiếng gần như chắc chắn là tab bị bỏ quên, không phải người học.
  @Max(43_200)
  timeSpentSeconds?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0, description: 'Điểm dừng video, giây.' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  lastPositionSeconds?: number | null;
}
