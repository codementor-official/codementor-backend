import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const KINDS = ['code', 'theory', 'quiz'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const STATUSES = [
  'draft',
  'pending_review',
  'changes_requested',
  'rejected',
  'published',
  'closed',
  'hidden',
  'archived',
] as const;

export class CreateExerciseDto {
  @ApiProperty({ example: 'Đảo ngược danh sách liên kết' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ enum: KINDS, default: 'code' })
  @IsIn(KINDS)
  kind!: (typeof KINDS)[number];

  @ApiProperty({ enum: DIFFICULTIES })
  @IsIn(DIFFICULTIES)
  difficulty!: (typeof DIFFICULTIES)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @ApiPropertyOptional({ description: 'Bỏ trống thì sinh từ tiêu đề' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;
}

/** Vắng mặt = giữ nguyên. Không có `status` ở đây: trạng thái đổi qua submit/withdraw. */
export class UpdateExerciseDto {
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
  @MaxLength(500)
  summary?: string | null;

  @ApiPropertyOptional({ enum: DIFFICULTIES })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: (typeof DIFFICULTIES)[number];

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  xpReward?: number;

  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  estimatedMinutes?: number | null;

  @ApiPropertyOptional({ minimum: 100, maximum: 60000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(60_000)
  timeLimitMs?: number;

  @ApiPropertyOptional({ minimum: 1024, maximum: 4194304 })
  @IsOptional()
  @IsInt()
  @Min(1024)
  @Max(4_194_304)
  memoryLimitKb?: number;
}

// Các lớp dưới đây phải khớp CHÍNH XÁC validator của collection `exercise_contents`:
// nó đang `strict` + `additionalProperties: false`, một trường lạ là bị MongoDB từ chối.
class TestCaseDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiProperty()
  @IsString()
  input!: string;

  @ApiProperty()
  @IsString()
  expected!: string;

  @ApiProperty({ enum: ['public', 'hidden'] })
  @IsIn(['public', 'hidden'])
  visibility!: 'public' | 'hidden';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  generated?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  weight?: number;
}

class LanguageDto {
  @ApiProperty({ example: 'python' })
  @IsString()
  id!: string;

  @ApiProperty({ example: 'Python 3.11' })
  @IsString()
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  monaco?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  starterCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceSolution?: string;
}

class ExampleDto {
  @ApiProperty()
  @IsString()
  input!: string;

  @ApiProperty()
  @IsString()
  output!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  explanation?: string;
}

class HintDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiProperty()
  @IsString()
  text!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  xpPenalty?: number;
}

class EvaluationDto {
  @ApiPropertyOptional({ enum: ['exact', 'trimmed', 'float', 'custom'] })
  @IsOptional()
  @IsIn(['exact', 'trimmed', 'float', 'custom'])
  checker?: 'exact' | 'trimmed' | 'float' | 'custom';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  floatTolerance?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customCheckerCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stopOnFirstFailure?: boolean;
}

class TheoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
}

export class SaveContentDto {
  @ApiPropertyOptional({ description: 'Đề bài, Markdown' })
  @IsOptional()
  @IsString()
  statement?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  constraints?: string[];

  @ApiPropertyOptional({ type: [HintDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HintDto)
  hints?: HintDto[];

  @ApiPropertyOptional({ type: [ExampleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExampleDto)
  examples?: ExampleDto[];

  @ApiPropertyOptional({ type: [TestCaseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  testCases?: TestCaseDto[];

  @ApiPropertyOptional({ type: [LanguageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LanguageDto)
  languages?: LanguageDto[];

  @ApiPropertyOptional({ type: EvaluationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EvaluationDto)
  evaluation?: EvaluationDto;

  @ApiPropertyOptional({ type: TheoryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TheoryDto)
  theory?: TheoryDto;
}
