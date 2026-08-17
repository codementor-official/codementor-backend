import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
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
export const IO_MODES = ['stdin_stdout', 'function'] as const;
export type IoMode = (typeof IO_MODES)[number];
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

  @ApiPropertyOptional({ description: 'stdin/stdout: đầu vào nạp qua stdin' })
  @IsOptional()
  @IsString()
  input?: string;

  @ApiPropertyOptional({
    description: 'Chế độ hàm: tham số theo VỊ TRÍ, khớp thứ tự signature.parameters',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  args?: unknown[];

  // Không kiểm kiểu: chuỗi ở chế độ stdin, giá trị JSON bất kỳ ở chế độ hàm. Ràng buộc thật
  // là "khớp với returnType", và nó cần Type IR nên nằm ở validateForSubmission.
  @ApiPropertyOptional({ description: 'Chuỗi ở chế độ stdin; giá trị JSON ở chế độ hàm' })
  @IsOptional()
  expected?: unknown;

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

class ParameterDto {
  @ApiProperty({ example: 'a' })
  @IsString()
  name!: string;

  // Type IR: { kind: 'list', of: { kind: 'float' } }. Không dựng cây DTO lồng nhau cho nó —
  // class-validator không diễn tả được kiểu đệ quy mà không tốn ba lớp phụ, và nguồn chân lý
  // là validator Mongo cùng bộ sinh code.
  @ApiProperty({ description: 'Type IR node', type: Object })
  @IsObject()
  type!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

class SignatureDto {
  @ApiProperty({ example: 'solve_quadratic', description: 'snake_case' })
  @IsString()
  functionName!: string;

  @ApiProperty({ type: [ParameterDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParameterDto)
  parameters!: ParameterDto[];

  @ApiProperty({ description: 'Type IR node', type: Object })
  @IsObject()
  returnType!: Record<string, unknown>;
}

class EvaluationDto {
  // `unordered` chỉ có nghĩa khi kết quả là giá trị có kiểu, tức chế độ hàm. `trimmed` và
  // `custom` là di sản stdin; judge coi chúng như `exact` khi chấm theo hàm.
  @ApiPropertyOptional({ enum: ['exact', 'trimmed', 'float', 'custom', 'unordered'] })
  @IsOptional()
  @IsIn(['exact', 'trimmed', 'float', 'custom', 'unordered'])
  checker?: 'exact' | 'trimmed' | 'float' | 'custom' | 'unordered';

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

  // Vắng mặt = `stdin_stdout`. Bài soạn trước khi có chế độ hàm không mang trường này và
  // không bị migrate — judge rẽ nhánh theo nó, không viết lại nó.
  @ApiPropertyOptional({ enum: IO_MODES })
  @IsOptional()
  @IsIn(IO_MODES)
  ioMode?: IoMode;

  @ApiPropertyOptional({ type: SignatureDto, description: 'Bắt buộc khi ioMode = function' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SignatureDto)
  signature?: SignatureDto;

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
