import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { FEATURE_KEYS, type BillingCycle, type FeatureKey } from '../domain/billing';

const MAX_BYTES = 1024 ** 5; // 1 PiB — far above any plan, still a safe integer.

export class DraftVersionDto {
  @IsString() @Length(1, 60) name!: string;
  @IsString() @MaxLength(120) tagline = '';
  @IsString() @MaxLength(600) description = '';
  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(120, { each: true }) highlights: string[] = [];
  @IsInt() @Min(0) @Max(999_999_999) monthlyPriceVnd!: number;
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(999_999_999) annualPriceVnd!: number | null;
  @IsInt() @Min(0) @Max(100_000) maxOwnedGroups!: number;
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(2) @Max(1_000_000) maxMembersPerGroup!: number | null;
  @IsInt() @Min(0) @Max(MAX_BYTES) maxStorageBytes!: number;
  @IsInt() @Min(1) @Max(MAX_BYTES) maxUploadBytes!: number;
  @IsInt() @Min(0) @Max(10_000_000) monthlyAiRequests!: number;
  @IsArray() @IsIn(FEATURE_KEYS, { each: true }) features: FeatureKey[] = [];
}

export class CreatePlanDto {
  @Matches(/^[a-z][a-z0-9-]{1,30}$/, { message: 'Code: lowercase letters, digits and dashes.' }) code!: string;
  @ValidateNested() @Type(() => DraftVersionDto) draft!: DraftVersionDto;
}

export class UpdatePlanDto {
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsOptional() @IsBoolean() isRecommended?: boolean;
  @IsOptional() @IsBoolean() isPurchasable?: boolean;
  @IsOptional() @IsIn(['active', 'hidden', 'archived']) status?: 'active' | 'hidden' | 'archived';
}

export class PublishVersionDto {
  @IsDateString() expectedUpdatedAt!: string;
  @IsOptional() @IsDateString() availableFrom?: string;
}

export class QuoteDto {
  @IsUUID() planId!: string;
  @IsIn(['month', 'year']) billingCycle!: BillingCycle;
  @IsOptional() @IsString() @Length(3, 32) couponCode?: string;
}

export class CheckoutDto extends QuoteDto {
  @IsIn(['mock', 'vnpay', 'momo']) provider!: 'mock' | 'vnpay' | 'momo';
  /** The amount the buyer saw; checkout fails instead of charging a different price. */
  @IsInt() @Min(0) expectedAmountVnd!: number;
}

export class ScheduleChangeDto {
  @IsUUID() planId!: string;
  @IsIn(['month', 'year']) billingCycle!: BillingCycle;
}

export class BillingPage {
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000) page = 1;
  @IsOptional() @IsIn(['pending', 'paid', 'failed', 'cancelled', 'expired', 'review', 'refunded']) status?: string;
  @IsOptional() @IsString() @Length(1, 100) q?: string;
}

export class SubscriberQuery extends BillingPage {
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'CANCEL_SCHEDULED', 'GRACE_PERIOD', 'EXPIRED', 'CANCELLED', 'SUSPENDED']) state?: string;
}

export class MockPaymentDto {
  @IsIn(['success', 'failure', 'cancelled', 'pending', 'unknown'])
  result!: 'success' | 'failure' | 'cancelled' | 'pending' | 'unknown';
}

export class ReasonDto {
  @IsString() @Length(5, 500) reason!: string;
}

export class AdjustmentDto extends ReasonDto {
  @IsIn(['max_owned_groups', 'max_members_per_group', 'max_storage_bytes', 'max_upload_bytes', 'monthly_ai_requests'])
  entitlement!: string;
  @IsInt() @Min(1) @Max(MAX_BYTES) amount!: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsDateString() endsAt!: string;
}

export class CouponDto {
  @Matches(/^[A-Za-z0-9_-]{3,32}$/) code!: string;
  @IsIn(['percent', 'fixed']) kind!: 'percent' | 'fixed';
  @IsInt() @Min(1) @Max(999_999_999) value!: number;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsOptional() @IsInt() @Min(1) maxRedemptions?: number;
  @IsInt() @Min(1) @Max(100) perUserLimit = 1;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) planIds?: string[];
  @IsOptional() @IsArray() @IsIn(['month', 'year'], { each: true }) billingCycles?: BillingCycle[];
  @IsBoolean() newCustomersOnly = false;
}

export class SettingsDto {
  @IsInt() @Min(0) @Max(30) graceDays!: number;
  @IsInt() @Min(1) @Max(30) renewalReminderDays!: number;
}
