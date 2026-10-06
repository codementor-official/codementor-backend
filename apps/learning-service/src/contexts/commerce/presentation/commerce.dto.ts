import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
export class RevenuePeriod {
  @Type(() => Number) @IsIn([7, 30, 90]) days = 30;
}
export class AdminRevenuePeriod extends RevenuePeriod {
  @IsOptional() @IsUUID() instructorId?: string;
}
export class CommercePage {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @IsIn(['pending', 'paid', 'failed', 'cancelled', 'expired', 'review', 'refunded']) status?: string;
  @IsOptional() @IsString() @Length(1, 100) q?: string;
  @IsOptional() @IsIn(['newest', 'oldest', 'amount_high', 'amount_low']) sort?: string;
}
export class CreateOrderDto {
  @IsUUID() courseId!: string;
  @IsIn(['mock', 'vnpay', 'momo']) provider!: 'mock' | 'vnpay' | 'momo';
}
export class PriceDto {
  @IsInt() @Min(0) @Max(1000000000) priceVnd!: number;
}
export class PromotionDto {
  @IsInt() @Min(1000) @Max(1000000000) salePriceVnd!: number;
  @IsString() @Length(2, 60) label!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsBoolean() isActive = true;
}
export class BatchPromotionDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('4', { each: true }) courseIds!: string[];
  @IsInt() @Min(1) @Max(99) discountPercent!: number;
  @IsString() @Length(2, 60) label!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsBoolean() isActive = true;
}
export class RecipientDto {
  @IsIn(['bank', 'momo', 'vnpay']) method!: 'bank' | 'momo' | 'vnpay';
  @IsString() @Length(2, 30) institutionCode!: string;
  @IsString() @Length(2, 100) accountName!: string;
  @IsString() @Length(4, 40) accountNumber!: string;
  @IsString() @Length(1, 100) label!: string;
  @Matches(/^TEST-[A-Za-z0-9-]{4,40}$/) testReference!: string;
}
export class WithdrawDto {
  @IsInt() @Min(1) @Max(1000000000) amount!: number;
  @IsUUID() idempotencyKey!: string;
  @IsIn(['success', 'failure', 'pending', 'timeout']) scenario!:
    'success' | 'failure' | 'pending' | 'timeout';
}
export class DecisionDto {
  @IsBoolean() approve!: boolean;
  @IsString() @Length(3, 1000) reason!: string;
}
export class ReasonDto {
  @IsString() @Length(3, 1000) reason!: string;
}
export class MockResultDto {
  @IsIn(['success', 'failure', 'cancelled', 'pending', 'unknown']) result!:
    'success' | 'failure' | 'cancelled' | 'pending' | 'unknown';
}
export class PolicyDto {
  @IsInt() @Min(0) @Max(10000) instructorBps!: number;
  @IsInt() @Min(0) @Max(90) holdDays!: number;
  @IsInt() @Min(1000) @Max(1000000000) minimumWithdrawal!: number;
  @IsBoolean() approvalRequired!: boolean;
}
export class ManualGrantDto {
  @IsUUID() userId!: string;
  @IsUUID() courseId!: string;
  @IsString() @Length(3, 1000) reason!: string;
}
