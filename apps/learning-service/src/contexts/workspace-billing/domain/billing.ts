/**
 * Workspace billing rules. Pure functions only: money is integer VND, time is UTC `Date`,
 * and nothing here reads the database or the clock implicitly.
 */
export type BillingCycle = 'month' | 'year';

export const MIN_CHARGE_VND = 5_000;

/** Closed registry of plan features; mirrors the CHECK on `workspace_plan_versions.features`. */
export const FEATURES = {
  priority_support: { label: 'Hỗ trợ ưu tiên', status: 'available' },
  advanced_assignments: { label: 'Quản lý bài tập nâng cao', status: 'available' },
  detailed_analytics: { label: 'Thống kê nhóm chi tiết', status: 'available' },
} as const;
export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export interface Entitlements {
  maxOwnedGroups: number;
  /** `null` = unlimited under the fair-use policy. */
  maxMembersPerGroup: number | null;
  maxStorageBytes: number;
  maxUploadBytes: number;
  monthlyAiRequests: number;
  features: FeatureKey[];
}

export interface VersionPrices {
  monthlyPriceVnd: number;
  annualPriceVnd: number | null;
}

/** List price for one billing period, or `null` when the cycle is not offered. */
export function priceFor(version: VersionPrices, cycle: BillingCycle): number | null {
  if (cycle === 'month') return version.monthlyPriceVnd > 0 ? version.monthlyPriceVnd : null;
  return version.annualPriceVnd;
}

/**
 * End of a period that starts at `start`. Calendar arithmetic in UTC; a day that does not exist
 * in the target month is clamped (Jan 31 + 1 month = Feb 28/29).
 */
export function addBillingPeriod(start: Date, cycle: BillingCycle): Date {
  const months = cycle === 'month' ? 1 : 12;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(start.getUTCDate(), lastDay),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}

/**
 * Unused value of a paid term at `now`, in whole VND rounded down — the customer is never
 * credited more than they paid, and the platform never keeps a fraction it did not earn twice.
 */
export function prorationCredit(paidVnd: number, termStart: Date, termEnd: Date, now: Date): number {
  if (!Number.isSafeInteger(paidVnd) || paidVnd <= 0) return 0;
  const total = BigInt(termEnd.getTime() - termStart.getTime());
  const left = BigInt(Math.max(0, termEnd.getTime() - Math.max(now.getTime(), termStart.getTime())));
  if (total <= 0n || left <= 0n) return 0;
  return Number((BigInt(paidVnd) * left) / total);
}

export interface CouponTerms {
  kind: 'percent' | 'fixed';
  value: number;
}

/**
 * Discount for a list price. Capped so the charge never drops below the gateways' minimum:
 * a subscription is only ever activated by a verified payment, so a 100% coupon cannot exist.
 */
export function couponDiscount(coupon: CouponTerms, listPriceVnd: number): number {
  const raw =
    coupon.kind === 'percent'
      ? Number((BigInt(listPriceVnd) * BigInt(coupon.value)) / 100n)
      : coupon.value;
  return Math.max(0, Math.min(raw, listPriceVnd - MIN_CHARGE_VND));
}

export type PlanChange = 'new' | 'renewal' | 'upgrade' | 'downgrade' | 'cycle_change';

/**
 * How a requested plan relates to the current subscription. Plans are ranked by their catalog
 * `sortOrder`; only renewals and upgrades are paid now, the rest are scheduled.
 */
export function classifyChange(
  current: { planId: string; sortOrder: number; cycle: BillingCycle } | null,
  target: { planId: string; sortOrder: number; cycle: BillingCycle },
): PlanChange {
  if (!current) return 'new';
  if (current.planId === target.planId)
    return current.cycle === target.cycle ? 'renewal' : 'cycle_change';
  return target.sortOrder > current.sortOrder ? 'upgrade' : 'downgrade';
}

export type SubscriptionState =
  | 'FREE'
  | 'ACTIVE'
  | 'CANCEL_SCHEDULED'
  | 'GRACE_PERIOD'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SUSPENDED';

export interface StateInput {
  paidThrough: Date | null;
  covered: boolean;
  cancelAtPeriodEnd: boolean;
  suspended: boolean;
  graceDays: number;
}

/** Same rule as `workspace_effective_entitlements()`; keep both in step. */
export function subscriptionState(s: StateInput | null, now: Date): SubscriptionState {
  if (!s || !s.paidThrough) return 'FREE';
  if (s.suspended) return 'SUSPENDED';
  if (s.covered) return s.cancelAtPeriodEnd ? 'CANCEL_SCHEDULED' : 'ACTIVE';
  if (s.cancelAtPeriodEnd) return 'CANCELLED';
  return now.getTime() < graceEnd(s.paidThrough, s.graceDays).getTime() ? 'GRACE_PERIOD' : 'EXPIRED';
}

export function graceEnd(paidThrough: Date, graceDays: number): Date {
  return new Date(paidThrough.getTime() + graceDays * 86_400_000);
}

/** States in which the subscription can still be renewed at its contract price. */
export function renewable(state: SubscriptionState): boolean {
  return state === 'ACTIVE' || state === 'CANCEL_SCHEDULED' || state === 'GRACE_PERIOD';
}

/** Validation shared by the admin editor and the publish step. Returns readable problems. */
export function versionProblems(v: VersionPrices & Entitlements & { isDefault: boolean }): string[] {
  const problems: string[] = [];
  const paid = (n: number) => Number.isSafeInteger(n) && n >= MIN_CHARGE_VND && n <= 999_999_999;
  if (v.isDefault) {
    if (v.monthlyPriceVnd !== 0 || v.annualPriceVnd !== null)
      problems.push('Gói mặc định phải miễn phí.');
  } else {
    if (!paid(v.monthlyPriceVnd)) problems.push('Giá theo tháng phải từ 5.000 ₫ đến 999.999.999 ₫.');
    if (v.annualPriceVnd !== null && !paid(v.annualPriceVnd))
      problems.push('Giá theo năm phải từ 5.000 ₫ đến 999.999.999 ₫.');
  }
  if (!Number.isSafeInteger(v.maxOwnedGroups) || v.maxOwnedGroups < 0)
    problems.push('Số nhóm sở hữu phải là số nguyên không âm.');
  if (v.maxMembersPerGroup !== null && (!Number.isSafeInteger(v.maxMembersPerGroup) || v.maxMembersPerGroup < 2))
    problems.push('Số thành viên mỗi nhóm phải từ 2 trở lên, hoặc không giới hạn.');
  if (!Number.isSafeInteger(v.maxStorageBytes) || v.maxStorageBytes < 0)
    problems.push('Dung lượng phải là số byte nguyên không âm.');
  if (!Number.isSafeInteger(v.maxUploadBytes) || v.maxUploadBytes <= 0)
    problems.push('Kích thước tệp tối đa phải lớn hơn 0.');
  else if (v.maxUploadBytes > Math.max(v.maxStorageBytes, 1))
    problems.push('Kích thước tệp tối đa không được vượt tổng dung lượng.');
  if (!Number.isSafeInteger(v.monthlyAiRequests) || v.monthlyAiRequests < 0)
    problems.push('Số lượt AI phải là số nguyên không âm.');
  if (v.features.some((f) => !(f in FEATURES))) problems.push('Tính năng không hợp lệ.');
  return problems;
}
