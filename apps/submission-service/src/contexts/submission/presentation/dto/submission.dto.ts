import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSubmissionDto {
  @IsUUID()
  exerciseId!: string;

  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  language!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  sourceCode!: string;

  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @IsUUID()
  lessonId?: string;
}

export class ListMySubmissionsDto {
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}
