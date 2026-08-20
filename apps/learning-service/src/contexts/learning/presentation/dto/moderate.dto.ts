import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * `revert` là đường LÙI cho một quyết định vừa lỡ tay: đưa nội dung trở lại hàng chờ để
 * xem lại, không xoá gì. Xem `Course.moderate`.
 */
export const DECISIONS = [
  'approve',
  'request_changes',
  'reject',
  'archive',
  'restore',
  'revert',
] as const;

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

/** Tác giả tự gỡ nội dung đang công khai của mình — lý do bắt buộc, admin đọc được vì sao. */
export class ArchiveMineDto {
  @ApiProperty({ description: 'Vì sao gỡ nội dung đang công khai — admin sẽ đọc được câu này' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
