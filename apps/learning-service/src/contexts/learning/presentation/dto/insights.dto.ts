import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

export class InsightsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30])
  days: 7 | 30 = 30;
}
