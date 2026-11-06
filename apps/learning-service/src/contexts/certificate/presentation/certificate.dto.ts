import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ClaimCertificateDto {
  @ApiProperty({ enum: ['course', 'roadmap'] })
  @IsIn(['course', 'roadmap'])
  subject!: 'course' | 'roadmap';

  @ApiProperty()
  @IsUUID()
  subjectId!: string;

  /** Chuẩn hóa và kiểm luật tên ở use case (`normalizeRecipientName`). */
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  recipientName!: string;
}

export class AdminCertificatesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RevokeCertificateDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
