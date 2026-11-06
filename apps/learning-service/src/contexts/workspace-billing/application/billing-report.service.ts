import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessRuleViolation } from '@codementor/kernel';
import { CommerceStore } from '../../commerce/infrastructure/commerce.store';
import { ON_SALE_VERSION } from './plan-catalog.service';
import { STATE_SQL, TERMS_SQL } from './billing-admin.service';
import type { ReportQuery } from '../presentation/workspace-billing.dto';

const STEP: Record<ReportQuery['bucket'], string> = { day: '1 day', month: '1 month', quarter: '3 months', year: '1 year' };
const MAX_DAYS = 366 * 5;
const MAX_ORDERS = 5000;

/**
 * Workspace plan revenue for a period in Vietnam time, from the ledger: a payment counts on the
 * day it was collected and a refund on the day it was recorded, so a period's net is exactly the
 * cash it kept. Plans and subscriber counts are as of now.
 */
@Injectable()
export class BillingReportService {
  constructor(private readonly store: CommerceStore) {}

  async report(q: ReportQuery) {
    const days = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000;
    if (!(days >= 0)) throw new BusinessRuleViolation('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
    if (days >= MAX_DAYS) throw new BusinessRuleViolation('Chọn tối đa 5 năm cho mỗi báo cáo.');

    const db = this.store.db;
    const start = Prisma.sql`(${q.from}::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`;
    const end = Prisma.sql`(${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`;
    // One row per ledger movement on platform revenue: + payment, − refund.
    const ledger = Prisma.sql`SELECT j.created_at, e.amount, o.id AS order_id, o.plan_id, o.kind
      FROM commerce_journals j
      JOIN commerce_entries e ON e.journal_id = j.id AND e.account = 'platform'
      JOIN workspace_orders o ON o.id = j.workspace_order_id
      WHERE j.created_at >= ${start} AND j.created_at < ${end}`;
    const counts = Prisma.sql`COALESCE(sum(amount) FILTER (WHERE amount > 0), 0)::bigint AS gross,
      COALESCE(-sum(amount) FILTER (WHERE amount < 0), 0)::bigint AS refunded,
      count(*) FILTER (WHERE amount > 0) AS payments, count(*) FILTER (WHERE amount < 0) AS refunds,
      count(*) FILTER (WHERE amount > 0 AND kind = 'new') AS new_subs,
      count(*) FILTER (WHERE amount > 0 AND kind = 'renewal') AS renewals,
      count(*) FILTER (WHERE amount > 0 AND kind = 'upgrade') AS upgrades`;
    const open = Prisma.sql`SELECT s.*, ${STATE_SQL} AS state FROM workspace_subscriptions s ${TERMS_SQL} WHERE s.ended_at IS NULL`;

    const [series, byPlan, discounts, plans, active, [accounts], orders] = await Promise.all([
      db.$queryRaw<(Counts & { bucket: string })[]>(Prisma.sql`
        WITH b AS (SELECT generate_series(date_trunc(${q.bucket}, ${q.from}::date::timestamp),
            date_trunc(${q.bucket}, ${q.to}::date::timestamp), ${STEP[q.bucket]}::interval) AS bucket),
          l AS (SELECT date_trunc(${q.bucket}, created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket, amount, kind FROM (${ledger}) x)
        SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket, ${counts}
        FROM b LEFT JOIN l ON l.bucket = b.bucket GROUP BY b.bucket ORDER BY b.bucket`),
      db.$queryRaw<(Counts & { plan_id: string })[]>(Prisma.sql`SELECT plan_id, ${counts} FROM (${ledger}) x GROUP BY plan_id`),
      db.$queryRaw<{ plan_id: string; discount: bigint; credit: bigint }[]>(Prisma.sql`
        SELECT plan_id, COALESCE(sum(discount_vnd), 0)::bigint AS discount, COALESCE(sum(credit_vnd), 0)::bigint AS credit
        FROM workspace_orders WHERE paid_at >= ${start} AND paid_at < ${end} GROUP BY plan_id`),
      db.$queryRaw<{ id: string; code: string; status: string; is_default: boolean; is_purchasable: boolean; sort_order: number;
        name: string | null; monthly_price_vnd: number | null; annual_price_vnd: number | null }[]>(Prisma.sql`
        SELECT p.id, p.code::text, p.status, p.is_default, p.is_purchasable, p.sort_order,
          v.name, v.monthly_price_vnd, v.annual_price_vnd
        FROM workspace_plans p LEFT JOIN LATERAL (${ON_SALE_VERSION}) v ON true ORDER BY p.sort_order, p.code`),
      db.$queryRaw<{ plan_id: string; n: bigint }[]>(Prisma.sql`
        SELECT plan_id, count(*) AS n FROM (${open}) x WHERE state IN ('ACTIVE','CANCEL_SCHEDULED','GRACE_PERIOD') GROUP BY plan_id`),
      db.$queryRaw<{ users: bigint }[]>`SELECT count(*) AS users FROM users`,
      db.$queryRaw<{ id: string; created_at: Date; paid_at: Date | null; status: string; kind: string; billing_cycle: string;
        plan: string; buyer: string; email: string; list_price_vnd: number; discount_vnd: number; credit_vnd: number;
        amount_vnd: number; refunded_vnd: number | null; coupon: string | null; reference: string | null;
        collected: bigint; returned: bigint; refunded_at: Date | null }[]>(Prisma.sql`
        SELECT o.id, o.created_at, o.paid_at, o.status, o.kind, o.billing_cycle, o.quote->'plan'->>'name' AS plan,
          u.display_name AS buyer, u.email::text AS email, o.list_price_vnd, o.discount_vnd, o.credit_vnd, o.amount_vnd,
          o.refunded_vnd, o.quote->'coupon'->>'code' AS coupon,
          (SELECT p.provider_ref FROM commerce_payments p WHERE p.workspace_order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS reference,
          COALESCE(sum(x.amount) FILTER (WHERE x.amount > 0), 0)::bigint AS collected,
          COALESCE(-sum(x.amount) FILTER (WHERE x.amount < 0), 0)::bigint AS returned,
          max(x.created_at) FILTER (WHERE x.amount < 0) AS refunded_at
        FROM (${ledger}) x JOIN workspace_orders o ON o.id = x.order_id JOIN users u ON u.id = o.buyer_id
        GROUP BY o.id, u.display_name, u.email ORDER BY min(x.created_at) LIMIT ${MAX_ORDERS}`),
    ]);

    const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
    const tally = (c: Counts | undefined) => ({
      grossVnd: n(c?.gross),
      refundedVnd: n(c?.refunded),
      netVnd: n(c?.gross) - n(c?.refunded),
      payments: n(c?.payments),
      refunds: n(c?.refunds),
      newSubscriptions: n(c?.new_subs),
      renewals: n(c?.renewals),
      upgrades: n(c?.upgrades),
    });
    const paying = active.reduce((sum, a) => sum + n(a.n), 0);
    const freeAccounts = Math.max(0, n(accounts.users) - paying);
    const planRows = plans.map((p) => {
      const d = discounts.find((x) => x.plan_id === p.id);
      return {
        planId: p.id,
        code: p.code,
        name: p.name ?? p.code,
        pricing: p.name === null ? ('unpublished' as const) : p.is_default || !p.monthly_price_vnd ? ('free' as const) : ('paid' as const),
        status: p.status,
        isDefault: p.is_default,
        isPurchasable: p.is_purchasable,
        monthlyPriceVnd: p.monthly_price_vnd,
        annualPriceVnd: p.annual_price_vnd,
        activeAccounts: p.is_default ? freeAccounts : n(active.find((a) => a.plan_id === p.id)?.n),
        discountVnd: n(d?.discount),
        creditVnd: n(d?.credit),
        ...tally(byPlan.find((x) => x.plan_id === p.id)),
      };
    });
    const totals = tally(
      byPlan.reduce<Counts>(
        (acc, c) => ({
          gross: acc.gross + BigInt(c.gross), refunded: acc.refunded + BigInt(c.refunded), payments: acc.payments + BigInt(c.payments),
          refunds: acc.refunds + BigInt(c.refunds), new_subs: acc.new_subs + BigInt(c.new_subs),
          renewals: acc.renewals + BigInt(c.renewals), upgrades: acc.upgrades + BigInt(c.upgrades),
        }),
        { gross: 0n, refunded: 0n, payments: 0n, refunds: 0n, new_subs: 0n, renewals: 0n, upgrades: 0n },
      ),
    );
    return {
      from: q.from,
      to: q.to,
      bucket: q.bucket,
      generatedAt: new Date(),
      totals: {
        ...totals,
        discountVnd: discounts.reduce((sum, d) => sum + n(d.discount), 0),
        creditVnd: discounts.reduce((sum, d) => sum + n(d.credit), 0),
        payingAccounts: paying,
        freeAccounts,
      },
      plans: planRows,
      series: series.map((s) => ({ bucket: s.bucket, ...tally(s) })),
      orders: orders.map((o) => ({
        id: o.id,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        refundedAt: o.refunded_at,
        status: o.status,
        kind: o.kind,
        billingCycle: o.billing_cycle,
        planName: o.plan,
        buyer: { name: o.buyer, email: o.email },
        listPriceVnd: o.list_price_vnd,
        discountVnd: o.discount_vnd,
        creditVnd: o.credit_vnd,
        amountVnd: o.amount_vnd,
        refundedVnd: o.refunded_vnd,
        coupon: o.coupon,
        reference: o.reference,
        collectedInPeriodVnd: n(o.collected),
        refundedInPeriodVnd: n(o.returned),
      })),
      ordersTruncated: orders.length === MAX_ORDERS,
    };
  }
}

interface Counts {
  gross: bigint;
  refunded: bigint;
  payments: bigint;
  refunds: bigint;
  new_subs: bigint;
  renewals: bigint;
  upgrades: bigint;
}
