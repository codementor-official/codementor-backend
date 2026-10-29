import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlreadyExists, BusinessRuleViolation, NotFound } from '@codementor/kernel';
import { CommerceStore, audit, journal, lock } from '../../commerce/infrastructure/commerce.store';
import { notifyCommerce } from '../../commerce/infrastructure/commerce-notification';
import { entitlementsOf, orderView, type EffectiveRow, type OrderRow, type SubscriptionRow } from '../infrastructure/billing.rows';
import { SubscriptionsService } from './subscriptions.service';
import type { AdjustmentDto, AuditQuery, BillingPage, CouponDto, RefundDto, SettingsDto, SubscriberQuery } from '../presentation/workspace-billing.dto';

/** SQL twin of `subscriptionState()`; `s` is a subscription, `t` its term summary. */
const STATE_SQL = Prisma.sql`CASE
  WHEN s.suspended_at IS NOT NULL THEN 'SUSPENDED'
  WHEN t.covered THEN CASE WHEN s.cancel_at_period_end THEN 'CANCEL_SCHEDULED' ELSE 'ACTIVE' END
  WHEN s.cancel_at_period_end THEN 'CANCELLED'
  WHEN now() < t.paid_through + make_interval(days => (SELECT grace_days FROM workspace_billing_settings)) THEN 'GRACE_PERIOD'
  ELSE 'EXPIRED' END`;

const TERMS_SQL = Prisma.sql`LEFT JOIN LATERAL (
  SELECT max(ends_at) AS paid_through, bool_or(starts_at <= now() AND ends_at > now()) AS covered
  FROM workspace_subscription_terms WHERE subscription_id = s.id) t ON true`;

@Injectable()
export class BillingAdminService {
  constructor(
    private readonly store: CommerceStore,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async overview() {
    const db = this.store.db;
    const [[counts], byPlan, [renewals], recent] = await Promise.all([
      db.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
        WITH subs AS (SELECT s.*, ${STATE_SQL} AS state, t.paid_through FROM workspace_subscriptions s ${TERMS_SQL} WHERE s.ended_at IS NULL)
        SELECT (SELECT count(*) FROM users) AS accounts,
          count(*) FILTER (WHERE state IN ('ACTIVE','CANCEL_SCHEDULED')) AS paid,
          count(*) FILTER (WHERE state = 'GRACE_PERIOD') AS grace,
          count(*) FILTER (WHERE state IN ('ACTIVE','CANCEL_SCHEDULED') AND paid_through < now() + interval '7 days') AS expiring,
          COALESCE(sum(CASE WHEN billing_cycle = 'year' THEN price_vnd / 12 ELSE price_vnd END)
            FILTER (WHERE state IN ('ACTIVE','CANCEL_SCHEDULED')), 0)::bigint AS contracted_monthly_vnd,
          (SELECT count(*) FROM workspace_orders WHERE status = 'failed' AND created_at > now() - interval '30 days') AS failed_30d,
          (SELECT count(*) FROM workspace_orders WHERE status = 'review') AS review,
          (SELECT COALESCE(sum(amount_vnd), 0) FROM workspace_orders WHERE status = 'paid' AND paid_at > now() - interval '30 days')::bigint AS revenue_30d,
          (SELECT COALESCE(sum(amount_vnd), 0) FROM workspace_orders WHERE status = 'paid')::bigint AS revenue_total
        FROM subs`),
      db.$queryRaw<{ plan_id: string; name: string; active: bigint; revenue: bigint }[]>`
        SELECT o.plan_id, max(o.quote->'plan'->>'name') AS name,
          count(DISTINCT o.result_subscription_id) FILTER (WHERE s.ended_at IS NULL) AS active,
          sum(o.amount_vnd)::bigint AS revenue
        FROM workspace_orders o LEFT JOIN workspace_subscriptions s ON s.id = o.result_subscription_id
        WHERE o.status = 'paid' GROUP BY o.plan_id ORDER BY revenue DESC`,
      // Of the terms that ended in the last 90 days, how many were followed by a renewal.
      db.$queryRaw<{ ended: bigint; renewed: bigint }[]>`
        SELECT count(*) AS ended, count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM workspace_subscription_terms n WHERE n.subscription_id = t.subscription_id AND n.starts_at >= t.ends_at)) AS renewed
        FROM workspace_subscription_terms t WHERE t.ends_at BETWEEN now() - interval '90 days' AND now()`,
      db.$queryRaw<{ action: string; entity_id: string; created_at: Date; details: unknown }[]>`
        SELECT action, entity_id, created_at, details FROM commerce_audit
        WHERE action LIKE 'workspace\\_%' ORDER BY created_at DESC LIMIT 20`,
    ]);
    const n = (v: bigint | undefined) => Number(v ?? 0);
    return {
      accounts: n(counts.accounts),
      paidSubscribers: n(counts.paid),
      freeAccounts: n(counts.accounts) - n(counts.paid) - n(counts.grace),
      gracePeriod: n(counts.grace),
      expiringIn7Days: n(counts.expiring),
      conversionRate: n(counts.accounts) ? n(counts.paid) / n(counts.accounts) : 0,
      renewalRate: n(renewals.ended) ? n(renewals.renewed) / n(renewals.ended) : null,
      // Manual renewals: this is the value of contracts in force, not guaranteed recurring revenue.
      contractedMonthlyValueVnd: n(counts.contracted_monthly_vnd),
      revenue30dVnd: n(counts.revenue_30d),
      revenueTotalVnd: n(counts.revenue_total),
      failedPayments30d: n(counts.failed_30d),
      ordersInReview: n(counts.review),
      revenueByPlan: byPlan.map((p) => ({ planId: p.plan_id, name: p.name, activeSubscriptions: n(p.active), revenueVnd: n(p.revenue) })),
      recentEvents: recent.map((e) => ({ action: e.action, entityId: e.entity_id, at: e.created_at, details: e.details })),
    };
  }

  async subscribers(q: SubscriberQuery) {
    const plan = q.planId ? Prisma.sql`AND s.plan_id = ${q.planId}::uuid` : Prisma.empty;
    const search = q.q?.trim()
      ? Prisma.sql`AND (u.display_name ILIKE ${`%${q.q.trim()}%`} OR u.email::text ILIKE ${`%${q.q.trim()}%`})`
      : Prisma.empty;
    const state = q.state ? Prisma.sql`WHERE state = ${q.state}` : Prisma.empty;
    const base = Prisma.sql`SELECT s.*, ${STATE_SQL} AS state, t.paid_through, u.display_name, u.email::text AS email, u.avatar_url,
        (SELECT count(*) FROM study_groups g WHERE g.owner_id = s.user_id)::int AS owned_groups,
        (SELECT o.over_since FROM workspace_owner_overage o WHERE o.owner_id = s.user_id) AS over_since,
        (SELECT COALESCE(sum(amount_vnd), 0) FROM workspace_orders wo WHERE wo.buyer_id = s.user_id AND wo.status = 'paid')::bigint AS lifetime_vnd
      FROM workspace_subscriptions s ${TERMS_SQL} JOIN users u ON u.id = s.user_id
      WHERE s.ended_at IS NULL ${plan} ${search}`;
    const [rows, [count]] = await Promise.all([
      this.store.db.$queryRaw<(SubscriptionRow & {
        state: string; paid_through: Date | null; display_name: string; email: string; avatar_url: string | null;
        owned_groups: number; over_since: Date | null; lifetime_vnd: bigint;
      })[]>(
        Prisma.sql`SELECT * FROM (${base}) x ${state} ORDER BY paid_through DESC NULLS LAST LIMIT 20 OFFSET ${(q.page - 1) * 20}`,
      ),
      this.store.db.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM (${base}) x ${state}`),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        user: { id: r.user_id, name: r.display_name, email: r.email, avatarUrl: r.avatar_url },
        planId: r.plan_id,
        planName: r.plan_name,
        billingCycle: r.billing_cycle,
        priceVnd: r.price_vnd,
        state: r.state,
        paidThrough: r.paid_through,
        cancelAtPeriodEnd: r.cancel_at_period_end,
        createdAt: r.created_at,
        ownedGroups: r.owned_groups,
        overLimitSince: r.over_since,
        lifetimeValueVnd: Number(r.lifetime_vnd),
      })),
      total: Number(count.total),
      page: q.page,
      limit: 20,
    };
  }

  /** Charts above the subscriber table: who pays, for what, and what is coming up. */
  async subscriberStats() {
    const db = this.store.db;
    const open = Prisma.sql`SELECT s.*, ${STATE_SQL} AS state, t.paid_through FROM workspace_subscriptions s ${TERMS_SQL} WHERE s.ended_at IS NULL`;
    const [byState, byPlan, byCycle, monthly, upcoming, [overage]] = await Promise.all([
      db.$queryRaw<{ state: string; n: bigint }[]>(Prisma.sql`SELECT state, count(*) AS n FROM (${open}) x GROUP BY state`),
      db.$queryRaw<{ plan_id: string; name: string; n: bigint; mrr: bigint }[]>(Prisma.sql`
        SELECT plan_id, max(plan_name) AS name, count(*) AS n,
          sum(CASE WHEN billing_cycle = 'year' THEN price_vnd / 12 ELSE price_vnd END)::bigint AS mrr
        FROM (${open}) x WHERE state IN ('ACTIVE','CANCEL_SCHEDULED','GRACE_PERIOD') GROUP BY plan_id ORDER BY n DESC`),
      db.$queryRaw<{ cycle: string; n: bigint }[]>(Prisma.sql`
        SELECT billing_cycle AS cycle, count(*) AS n FROM (${open}) x
        WHERE state IN ('ACTIVE','CANCEL_SCHEDULED','GRACE_PERIOD') GROUP BY billing_cycle`),
      // Last six months in Vietnam time: new subscriptions, renewals and cash collected.
      db.$queryRaw<{ month: string; new_subs: bigint; renewals: bigint; revenue: bigint }[]>`
        WITH months AS (
          SELECT to_char(m, 'YYYY-MM') AS month FROM generate_series(
            date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '5 months',
            date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'), interval '1 month') m),
        paid AS (SELECT kind, amount_vnd, to_char(paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') AS month
          FROM workspace_orders WHERE status IN ('paid','refunded') AND paid_at IS NOT NULL)
        SELECT m.month, count(p.*) FILTER (WHERE p.kind IN ('new','upgrade')) AS new_subs,
          count(p.*) FILTER (WHERE p.kind = 'renewal') AS renewals, COALESCE(sum(p.amount_vnd), 0)::bigint AS revenue
        FROM months m LEFT JOIN paid p ON p.month = m.month GROUP BY m.month ORDER BY m.month`,
      // Contracts whose paid period ends in the next 30 days, by week.
      db.$queryRaw<{ week: number; n: bigint; value: bigint }[]>(Prisma.sql`
        SELECT LEAST(3, floor(extract(epoch FROM paid_through - now()) / 604800))::int AS week, count(*) AS n,
          sum(price_vnd)::bigint AS value
        FROM (${open}) x WHERE state IN ('ACTIVE','CANCEL_SCHEDULED') AND paid_through < now() + interval '30 days'
        GROUP BY 1 ORDER BY 1`),
      db.$queryRaw<{ notice: bigint; read_only: bigint; hidden: bigint }[]>`
        SELECT count(*) FILTER (WHERE now() < o.over_since + make_interval(days => s.overage_notice_days)) AS notice,
          count(*) FILTER (WHERE now() >= o.over_since + make_interval(days => s.overage_notice_days)
            AND now() < o.over_since + make_interval(days => s.overage_notice_days + s.overage_read_only_days)) AS read_only,
          count(*) FILTER (WHERE now() >= o.over_since + make_interval(days => s.overage_notice_days + s.overage_read_only_days)) AS hidden
        FROM workspace_owner_overage o CROSS JOIN workspace_billing_settings s`,
    ]);
    const n = (v: bigint | undefined) => Number(v ?? 0);
    return {
      byState: byState.map((r) => ({ state: r.state, count: n(r.n) })),
      byPlan: byPlan.map((r) => ({ planId: r.plan_id, name: r.name, count: n(r.n), monthlyValueVnd: n(r.mrr) })),
      byCycle: byCycle.map((r) => ({ cycle: r.cycle, count: n(r.n) })),
      monthly: monthly.map((r) => ({ month: r.month, newSubscriptions: n(r.new_subs), renewals: n(r.renewals), revenueVnd: n(r.revenue) })),
      expiringByWeek: [0, 1, 2, 3].map((week) => {
        const row = upcoming.find((u) => u.week === week);
        return { week, count: n(row?.n), valueVnd: n(row?.value) };
      }),
      overLimitOwners: { notice: n(overage?.notice), readOnly: n(overage?.read_only), hidden: n(overage?.hidden) },
    };
  }

  /** Everything about one account's Workspace billing, newest first. */
  async subscriber(userId: string) {
    const db = this.store.db;
    const [[user], [effective], subs, orders, adjustments] = await Promise.all([
      db.$queryRaw<{ id: string; display_name: string; email: string; avatar_url: string | null }[]>`
        SELECT id, display_name, email::text, avatar_url FROM users WHERE id = ${userId}::uuid`,
      db.$queryRaw<EffectiveRow[]>`SELECT * FROM workspace_effective_entitlements(${userId}::uuid)`,
      db.$queryRaw<SubscriptionRow[]>`SELECT * FROM workspace_subscriptions WHERE user_id = ${userId}::uuid ORDER BY created_at DESC`,
      db.$queryRaw<OrderRow[]>`SELECT * FROM workspace_orders WHERE buyer_id = ${userId}::uuid ORDER BY created_at DESC LIMIT 50`,
      db.$queryRaw<Record<string, unknown>[]>`SELECT a.*, u.display_name AS created_by_name FROM workspace_entitlement_adjustments a
        JOIN users u ON u.id = a.created_by WHERE a.user_id = ${userId}::uuid ORDER BY a.created_at DESC`,
    ]);
    if (!user) throw new NotFound('Người dùng', userId);
    const terms = subs.length
      ? await db.$queryRaw<{ subscription_id: string; starts_at: Date; ends_at: Date; order_id: string }[]>`
          SELECT subscription_id, starts_at, ends_at, order_id FROM workspace_subscription_terms
          WHERE subscription_id = ANY(${subs.map((s) => s.id)}::uuid[]) ORDER BY starts_at`
      : [];
    const open = await this.subscriptions.openSubscription(db, userId, new Date());
    return {
      user: { id: user.id, name: user.display_name, email: user.email, avatarUrl: user.avatar_url },
      state: open?.state ?? 'FREE',
      effective: effective && { source: effective.source, planName: effective.plan_name, entitlements: entitlementsOf(effective) },
      subscriptions: subs.map((s) => ({
        id: s.id,
        planName: s.plan_name,
        planVersionId: s.plan_version_id,
        billingCycle: s.billing_cycle,
        priceVnd: s.price_vnd,
        entitlements: entitlementsOf(s),
        termsVersion: s.terms_version,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        endedAt: s.ended_at,
        endReason: s.end_reason,
        suspendedAt: s.suspended_at,
        suspendedReason: s.suspended_reason,
        createdAt: s.created_at,
        terms: terms.filter((t) => t.subscription_id === s.id).map((t) => ({ startsAt: t.starts_at, endsAt: t.ends_at, orderId: t.order_id })),
      })),
      orders: orders.map(orderView),
      adjustments,
    };
  }

  async setSuspended(actorId: string, userId: string, suspend: boolean, reason: string) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-billing:${userId}`);
      const [sub] = await tx.$queryRaw<SubscriptionRow[]>`
        SELECT * FROM workspace_subscriptions WHERE user_id = ${userId}::uuid AND ended_at IS NULL FOR UPDATE`;
      if (!sub) throw new NotFound('Gói Workspace đang mở');
      if (!!sub.suspended_at === suspend)
        throw new BusinessRuleViolation(suspend ? 'Gói đã bị tạm ngưng.' : 'Gói không ở trạng thái tạm ngưng.');
      await tx.$executeRaw`UPDATE workspace_subscriptions SET
        suspended_at = ${suspend ? new Date() : null}, suspended_reason = ${suspend ? reason.trim() : null}, updated_at = now()
        WHERE id = ${sub.id}::uuid`;
      await audit(tx, suspend ? 'workspace_subscription.suspended' : 'workspace_subscription.restored', sub.id, actorId, { reason });
      return { suspended: suspend };
    });
  }

  async addAdjustment(actorId: string, userId: string, dto: AdjustmentDto) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BusinessRuleViolation('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
    if (endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000)
      throw new BusinessRuleViolation('Điều chỉnh chỉ có hiệu lực tối đa một năm.');
    return this.store.transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO workspace_entitlement_adjustments(user_id, entitlement, amount, starts_at, ends_at, reason, created_by)
        VALUES (${userId}::uuid, ${dto.entitlement}, ${BigInt(dto.amount)}, ${startsAt}, ${endsAt}, ${dto.reason.trim()}, ${actorId}::uuid)
        RETURNING id`;
      await audit(tx, 'workspace_adjustment.created', row.id, actorId, { userId, ...dto });
      return { id: row.id };
    });
  }

  async revokeAdjustment(actorId: string, id: string, reason: string) {
    return this.store.transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`UPDATE workspace_entitlement_adjustments
        SET revoked_at = now(), revoked_by = ${actorId}::uuid WHERE id = ${id}::uuid AND revoked_at IS NULL RETURNING id`;
      if (!row) throw new NotFound('Điều chỉnh đang hiệu lực', id);
      await audit(tx, 'workspace_adjustment.revoked', id, actorId, { reason });
      return { revoked: true };
    });
  }

  async orders(q: BillingPage) {
    const status = q.status ? Prisma.sql`AND o.status = ${q.status}` : Prisma.empty;
    const search = q.q?.trim()
      ? Prisma.sql`AND (u.display_name ILIKE ${`%${q.q.trim()}%`} OR u.email::text ILIKE ${`%${q.q.trim()}%`})`
      : Prisma.empty;
    const where = Prisma.sql`FROM workspace_orders o JOIN users u ON u.id = o.buyer_id WHERE true ${status} ${search}`;
    const [rows, [count]] = await Promise.all([
      this.store.db.$queryRaw<(OrderRow & { display_name: string; email: string })[]>(
        Prisma.sql`SELECT o.*, u.display_name, u.email::text ${where} ORDER BY o.created_at DESC LIMIT 20 OFFSET ${(q.page - 1) * 20}`,
      ),
      this.store.db.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${where}`),
    ]);
    return {
      items: rows.map((r) => ({ ...orderView(r), buyer: { id: r.buyer_id, name: r.display_name, email: r.email } })),
      total: Number(count.total),
      page: q.page,
      limit: 20,
    };
  }

  /**
   * Records a full refund made through the gateway. The ledger gets a compensating entry, the
   * order becomes `refunded`, and a term that has not ended yet ends the subscription now —
   * the customer keeps their data, not the paid limits they were refunded for.
   */
  async refundOrder(actorId: string, orderId: string, dto: RefundDto) {
    return this.store.transaction(async (tx) => {
      const [frozen] = await tx.$queryRaw<OrderRow[]>`SELECT * FROM workspace_orders WHERE id = ${orderId}::uuid`;
      if (!frozen) throw new NotFound('Đơn gói Workspace', orderId);
      await lock(tx, `ws-billing:${frozen.buyer_id}`);
      const [order] = await tx.$queryRaw<OrderRow[]>`SELECT * FROM workspace_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (order.status !== 'paid' && order.status !== 'review')
        throw new BusinessRuleViolation('Chỉ hoàn tiền được đơn đã thanh toán hoặc đang chờ kiểm tra.');
      const [payment] = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM commerce_payments WHERE workspace_order_id = ${orderId}::uuid FOR UPDATE`;
      if (payment?.status !== 'succeeded') throw new BusinessRuleViolation('Đơn này chưa có khoản thanh toán thành công.');
      await journal(tx, `ws-refund:${orderId}`, [
        { account: 'platform', amount: -order.amount_vnd },
        { account: 'clearing', amount: order.amount_vnd },
      ], { workspaceOrder: orderId });
      await tx.$executeRaw`UPDATE workspace_orders SET status = 'refunded' WHERE id = ${orderId}::uuid`;
      let endedSubscription = false;
      if (order.status === 'paid' && order.result_subscription_id) {
        const [term] = await tx.$queryRaw<{ ends_at: Date }[]>`
          SELECT ends_at FROM workspace_subscription_terms WHERE order_id = ${orderId}::uuid`;
        if (term && term.ends_at > new Date()) {
          const ended = await tx.$executeRaw`UPDATE workspace_subscriptions SET ended_at = now(), end_reason = 'refunded', updated_at = now()
            WHERE id = ${order.result_subscription_id}::uuid AND ended_at IS NULL`;
          endedSubscription = ended > 0;
        }
      }
      await audit(tx, 'workspace_order.refunded', orderId, actorId, {
        amountVnd: order.amount_vnd,
        reason: dto.reason,
        gatewayReference: dto.gatewayReference ?? null,
        endedSubscription,
      });
      await notifyCommerce(tx, order.buyer_id, orderId, 'Đã hoàn tiền gói Workspace',
        `Khoản ${order.amount_vnd.toLocaleString('vi-VN')} ₫ cho gói ${order.quote.plan.name} đã được hoàn.${endedSubscription ? ' Tài khoản trở về hạn mức Free; dữ liệu vẫn được giữ nguyên.' : ''}`,
        '/workspace/billing');
      return { refunded: true, endedSubscription };
    });
  }

  async coupons() {
    const rows = await this.store.db.$queryRaw<Record<string, unknown>[]>`
      SELECT c.*, (SELECT count(*) FROM workspace_coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'redeemed')::int AS redeemed,
        (SELECT count(*) FROM workspace_coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'reserved')::int AS reserved
      FROM workspace_coupons c ORDER BY c.created_at DESC`;
    return rows;
  }

  async createCoupon(actorId: string, dto: CouponDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BusinessRuleViolation('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
    if (dto.kind === 'percent' && dto.value > 100) throw new BusinessRuleViolation('Phần trăm giảm không được vượt 100.');
    return this.store.transaction(async (tx) => {
      const [exists] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM workspace_coupons WHERE code = ${dto.code}`;
      if (exists) throw new AlreadyExists('Mã giảm giá', { code: dto.code });
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO workspace_coupons(code, kind, value, starts_at, ends_at, max_redemptions, per_user_limit, plan_ids,
          billing_cycles, new_customers_only, created_by)
        VALUES (${dto.code}, ${dto.kind}, ${dto.value}, ${startsAt}, ${endsAt}, ${dto.maxRedemptions ?? null}::integer,
          ${dto.perUserLimit}, ${dto.planIds?.length ? dto.planIds : null}::uuid[],
          ${dto.billingCycles?.length ? dto.billingCycles : null}::text[], ${dto.newCustomersOnly}, ${actorId}::uuid)
        RETURNING id`;
      await audit(tx, 'workspace_coupon.created', row.id, actorId, dto);
      return { id: row.id };
    });
  }

  /** Coupons are never edited after creation (orders carry their terms); they are only switched on or off. */
  async setCouponActive(actorId: string, id: string, active: boolean) {
    return this.store.transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`UPDATE workspace_coupons SET is_active = ${active}
        WHERE id = ${id}::uuid AND is_active <> ${active} RETURNING id`;
      if (!row) throw new NotFound(active ? 'Mã giảm giá đang tắt' : 'Mã giảm giá đang hoạt động', id);
      await audit(tx, active ? 'workspace_coupon.activated' : 'workspace_coupon.deactivated', id, actorId);
      return { active };
    });
  }

  async settings() {
    const [row] = await this.store.db.$queryRaw<{
      grace_days: number; renewal_reminder_days: number; overage_notice_days: number; overage_read_only_days: number;
      terms_version: string; updated_at: Date; updated_by_name: string | null;
    }[]>`
      SELECT s.grace_days, s.renewal_reminder_days, s.overage_notice_days, s.overage_read_only_days, s.terms_version,
        s.updated_at, u.display_name AS updated_by_name
      FROM workspace_billing_settings s LEFT JOIN users u ON u.id = s.updated_by`;
    return {
      graceDays: row.grace_days,
      renewalReminderDays: row.renewal_reminder_days,
      overageNoticeDays: row.overage_notice_days,
      overageReadOnlyDays: row.overage_read_only_days,
      termsVersion: row.terms_version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by_name,
    };
  }

  async updateSettings(actorId: string, dto: SettingsDto) {
    return this.store.transaction(async (tx) => {
      const before = await this.settings();
      await tx.$executeRaw`UPDATE workspace_billing_settings SET grace_days = ${dto.graceDays},
        renewal_reminder_days = ${dto.renewalReminderDays}, overage_notice_days = ${dto.overageNoticeDays},
        overage_read_only_days = ${dto.overageReadOnlyDays}, updated_by = ${actorId}::uuid, updated_at = now()`;
      await audit(tx, 'workspace_settings.updated', null, actorId, { before, after: dto });
      return this.settings();
    });
  }

  /** `subject` names what the entry is about: the customer, the coupon code or the plan. */
  async auditLog(q: AuditQuery) {
    const filter = q.category ? `workspace\\_${q.category}.%` : 'workspace\\_%';
    const [rows, [count]] = await Promise.all([
      this.store.db.$queryRaw<{ id: string; action: string; entity_id: string | null; details: unknown; created_at: Date; actor: string | null; subject: string | null }[]>`
        SELECT a.id, a.action, a.entity_id, a.details, a.created_at, u.display_name AS actor,
          COALESCE(
            (SELECT su.display_name FROM workspace_subscriptions s JOIN users su ON su.id = s.user_id WHERE s.id = a.entity_id),
            (SELECT ou.display_name FROM workspace_orders o JOIN users ou ON ou.id = o.buyer_id WHERE o.id = a.entity_id),
            (SELECT c.code::text FROM workspace_coupons c WHERE c.id = a.entity_id),
            (SELECT 'Gói ' || p.code::text FROM workspace_plans p WHERE p.id = a.entity_id),
            (SELECT au.display_name FROM workspace_entitlement_adjustments ad JOIN users au ON au.id = ad.user_id WHERE ad.id = a.entity_id),
            (SELECT x.display_name FROM users x WHERE x.id = a.entity_id)
          ) AS subject
        FROM commerce_audit a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.action LIKE ${filter} ORDER BY a.created_at DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      this.store.db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM commerce_audit WHERE action LIKE ${filter}`,
    ]);
    return { items: rows, total: Number(count.total), page: q.page, limit: q.limit };
  }
}
