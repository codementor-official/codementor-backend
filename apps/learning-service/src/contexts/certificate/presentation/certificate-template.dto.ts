import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IMAGE_CONTENT_TYPES } from '@codementor/platform';

export class CertificateTemplateDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ enum: ['course', 'roadmap'], nullable: true })
  @IsOptional()
  @IsIn(['course', 'roadmap'])
  subject?: 'course' | 'roadmap' | null;

  /** Kiểm chi tiết ở `validateDesign` — class-validator không diễn tả được luật placeholder. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  design!: Record<string, unknown>;
}

export class CertificateAssetUploadDto {
  @ApiProperty({ enum: ['logo', 'signature'] })
  @IsIn(['logo', 'signature'])
  kind!: 'logo' | 'signature';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({ enum: IMAGE_CONTENT_TYPES })
  @IsIn(IMAGE_CONTENT_TYPES)
  contentType!: (typeof IMAGE_CONTENT_TYPES)[number];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes!: number;
}

export class AttachCertificateTemplateDto {
  /** `null` = dùng mẫu mặc định của nền tảng. */
  @ApiProperty({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  templateId!: string | null;
}
