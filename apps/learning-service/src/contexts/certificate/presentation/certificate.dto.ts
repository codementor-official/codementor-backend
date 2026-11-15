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

  @ApiPropertyOptional({ enum: ['active', 'revoked'] })
  @IsOptional()
  @IsIn(['active', 'revoked'])
  status?: 'active' | 'revoked';

  @ApiPropertyOptional({ enum: ['course', 'roadmap'] })
  @IsOptional()
  @IsIn(['course', 'roadmap'])
  subject?: 'course' | 'roadmap';

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

export class CompletionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['claimed', 'unclaimed'] })
  @IsOptional()
  @IsIn(['claimed', 'unclaimed'])
  certificate?: 'claimed' | 'unclaimed';

  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'name'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'name'])
  sort: 'newest' | 'oldest' | 'name' = 'newest';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(100)
  limit = 10;
}
