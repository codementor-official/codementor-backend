import type { BillingCycle, Entitlements, FeatureKey } from '../domain/billing';

/** Row shapes returned by `$queryRaw`; bigint columns arrive as `bigint`. */
export interface PlanRow {
  id: string;
  code: string;
  sort_order: number;
  is_default: boolean;
  is_recommended: boolean;
  is_purchasable: boolean;
  status: 'active' | 'hidden' | 'archived';
  created_at: Date;
  updated_at: Date;
}

export interface VersionRow {
  id: string;
  plan_id: string;
  version: number;
  status: 'draft' | 'published';
  name: string;
  tagline: string;
  description: string;
  highlights: string[];
  monthly_price_vnd: number;
  annual_price_vnd: number | null;
  max_owned_groups: number;
  max_members_per_group: number | null;
  max_storage_bytes: bigint;
  max_upload_bytes: bigint;
  monthly_ai_requests: number;
  features: string[];
  available_from: Date | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  plan_version_id: string;
  billing_cycle: BillingCycle;
  price_vnd: number;
  plan_name: string;
  max_owned_groups: number;
  max_members_per_group: number | null;
  max_storage_bytes: bigint;
  max_upload_bytes: bigint;
  monthly_ai_requests: number;
  features: string[];
  terms_version: string;
  snapshot: QuoteSnapshot & { orderId: string };
  cancel_at_period_end: boolean;
  scheduled_plan_id: string | null;
  scheduled_cycle: BillingCycle | null;
  ended_at: Date | null;
  end_reason: string | null;
  suspended_at: Date | null;
  suspended_reason: string | null;
  created_at: Date;
}

export interface OrderRow {
  id: string;
  buyer_id: string;
  kind: 'new' | 'renewal' | 'upgrade';
  plan_id: string;
  plan_version_id: string;
  billing_cycle: BillingCycle;
  subscription_id: string | null;
  list_price_vnd: number;
  discount_vnd: number;
  credit_vnd: number;
  amount_vnd: number;
  coupon_id: string | null;
  quote: QuoteSnapshot;
  mode: 'mock' | 'sandbox';
  status: string;
  result_subscription_id: string | null;
  paid_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

export interface EffectiveRow {
  source: 'free' | 'paid' | 'grace';
  subscription_id: string | null;
  plan_id: string;
  plan_version_id: string;
  plan_code: string;
  plan_name: string;
  max_owned_groups: number;
  max_members_per_group: number | null;
  max_storage_bytes: bigint;
  max_upload_bytes: bigint;
  monthly_ai_requests: number;
  features: string[];
  paid_through: Date | null;
  grace_ends_at: Date | null;
}

/** Everything the buyer agreed to, frozen on the order and copied onto the subscription. */
export interface QuoteSnapshot {
  kind: 'new' | 'renewal' | 'upgrade';
  plan: { id: string; code: string; name: string; versionId: string; version: number };
  billingCycle: BillingCycle;
  entitlements: Entitlements;
  listPriceVnd: number;
  discountVnd: number;
  creditVnd: number;
  amountVnd: number;
  coupon: { id: string; code: string; kind: 'percent' | 'fixed'; value: number } | null;
  credit: { subscriptionId: string; termStart: string; termEnd: string; paidVnd: number } | null;
  startsAt: string | null;
  termsVersion: string;
  quotedAt: string;
}

type EntitlementColumns = Pick<
  VersionRow,
  'max_owned_groups' | 'max_members_per_group' | 'max_storage_bytes' | 'max_upload_bytes' | 'monthly_ai_requests' | 'features'
>;

export function entitlementsOf(row: EntitlementColumns): Entitlements {
  return {
    maxOwnedGroups: row.max_owned_groups,
    maxMembersPerGroup: row.max_members_per_group,
    maxStorageBytes: Number(row.max_storage_bytes),
    maxUploadBytes: Number(row.max_upload_bytes),
    monthlyAiRequests: row.monthly_ai_requests,
    features: row.features as FeatureKey[],
  };
}

export function pricesOf(v: Pick<VersionRow, 'monthly_price_vnd' | 'annual_price_vnd'>) {
  return { monthlyPriceVnd: v.monthly_price_vnd, annualPriceVnd: v.annual_price_vnd };
}

export function versionView(v: VersionRow) {
  return {
    id: v.id,
    planId: v.plan_id,
    version: v.version,
    status: v.status,
    name: v.name,
    tagline: v.tagline,
    description: v.description,
    highlights: v.highlights,
    monthlyPriceVnd: v.monthly_price_vnd,
    annualPriceVnd: v.annual_price_vnd,
    entitlements: entitlementsOf(v),
    availableFrom: v.available_from,
    publishedAt: v.published_at,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  };
}

export function planView(p: PlanRow) {
  return {
    id: p.id,
    code: p.code,
    sortOrder: p.sort_order,
    isDefault: p.is_default,
    isRecommended: p.is_recommended,
    isPurchasable: p.is_purchasable,
    status: p.status,
  };
}

export function orderView(o: OrderRow) {
  return {
    id: o.id,
    kind: o.kind,
    planId: o.plan_id,
    planName: o.quote.plan.name,
    billingCycle: o.billing_cycle,
    listPriceVnd: o.list_price_vnd,
    discountVnd: o.discount_vnd,
    creditVnd: o.credit_vnd,
    amountVnd: o.amount_vnd,
    currency: 'VND',
    coupon: o.quote.coupon ? { code: o.quote.coupon.code } : null,
    entitlements: o.quote.entitlements,
    status: o.status,
    mode: o.mode,
    subscriptionId: o.result_subscription_id,
    paidAt: o.paid_at,
    expiresAt: o.expires_at,
    createdAt: o.created_at,
  };
}
