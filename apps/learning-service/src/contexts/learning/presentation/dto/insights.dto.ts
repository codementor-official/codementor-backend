import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export class InsightsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30])
  days: 7 | 30 = 30;
}

export class LearningReportQueryDto extends InsightsQueryDto {
  /** `all` = toàn nền tảng, chỉ admin. Mặc định là nội dung của chính người hỏi. */
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope: 'mine' | 'all' = 'mine';
}
