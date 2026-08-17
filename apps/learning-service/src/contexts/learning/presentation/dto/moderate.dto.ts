import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export const DECISIONS = ['approve', 'request_changes', 'reject', 'archive', 'restore'] as const;

export class ModerateDto {
  @ApiProperty({ enum: DECISIONS })
  @IsIn(DECISIONS)
  decision!: (typeof DECISIONS)[number];

  @ApiPropertyOptional({ nullable: true, description: 'Bắt buộc khi từ chối hoặc yêu cầu sửa' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  reason?: string | null;
}
