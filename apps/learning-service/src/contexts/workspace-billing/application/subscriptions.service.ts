import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessRuleViolation, NotFound } from '@codementor/kernel';
import { CommerceStore, audit, journal, lock, type Tx } from '../../commerce/infrastructure/commerce.store';
import { PaymentProviders } from '../../commerce/infrastructure/payment-providers';
import { OrdersService } from '../../commerce/application/orders.service';
import { notifyCommerce } from '../../commerce/infrastructure/commerce-notification';
import type { PaymentEvidence, PaymentProvider } from '../../commerce/domain/money';
import {
  MIN_CHARGE_VND,
  addBillingPeriod,
  classifyChange,
  couponDiscount,
  graceEnd,
  priceFor,
  prorationCredit,
  renewable,
  subscriptionState,
  type BillingCycle,
  type SubscriptionState,
} from '../domain/billing';
import {
  entitlementsOf,
  orderView,
  pricesOf,
  type EffectiveRow,
  type OrderRow,
  type PlanRow,
  type QuoteSnapshot,
  type SubscriptionRow,
  type VersionRow,
} from '../infrastructure/billing.rows';
import { ON_SALE_VERSION } from './plan-catalog.service';
import type { CheckoutDto, QuoteDto, ScheduleChangeDto } from '../presentation/workspace-billing.dto';

interface TermRow {
  id: string;
  order_id: string;
  starts_at: Date;
  ends_at: Date;
  amount_vnd: number;
}

interface OpenSubscription {
  row: SubscriptionRow;
  terms: TermRow[];
  paidThrough: Date | null;
  covering: TermRow | null;
  state: SubscriptionState;
}

interface CouponRow {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  starts_at: Date;
  ends_at: Date;
  max_redemptions: number | null;
  per_user_limit: number;
  plan_ids: string[] | null;
  billing_cycles: string[] | null;
  new_customers_only: boolean;
  is_active: boolean;
}

interface PaymentRow {
  id: string;
  workspace_order_id: string;
  provider: PaymentProvider;
  status: string;
  provider_ref: string | null;
  checkout_url: string | null;
  create_started_at: Date | null;
  created_at: Date;
}

const RESULT_PATH = '/workspace/billing/checkout/result';

/** Machine-readable codes the frontend keys on; messages are for people. */
export const BILLING_CODES = {
  planChangeConflict: 'WORKSPACE_PLAN_CHANGE_CONFLICT',
  priceChanged: 'WORKSPACE_QUOTE_CHANGED',
  couponInvalid: 'WORKSPACE_COUPON_INVALID',
} as const;

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  constructor(
    private readonly store: CommerceStore,
    private readonly providers: PaymentProviders,
    private readonly orders: OrdersService,
  ) {}

  /** Provider callbacks arrive through the course commerce endpoints; route ours here. */
  onModuleInit() {
    this.orders.useWorkspacePayments({ apply: (provider, e, reconciled) => this.applyPayment(provider, e, reconciled) });
  }

  // ------------------------------------------------------------------ reads

  async overview(userId: string) {
    const now = new Date();
    const [effective] = await this.store.db.$queryRaw<EffectiveRow[]>`SELECT * FROM workspace_effective_entitlements(${userId}::uuid)`;
    if (!effective) throw new BusinessRuleViolation('Workspace plans are not configured.', { code: 'WORKSPACE_ENTITLEMENT_UNAVAILABLE' });
    const open = await this.openSubscription(this.store.db, userId, now);
    const [settings] = await this.store.db.$queryRaw<{ grace_days: number; renewal_reminder_days: number }[]>`
      SELECT grace_days, renewal_reminder_days FROM workspace_billing_settings`;
    const [pending] = await this.store.db.$queryRaw<OrderRow[]>`
      SELECT * FROM workspace_orders WHERE buyer_id = ${userId}::uuid AND status = 'pending' AND expires_at > now()`;
    const scheduled = open?.row.scheduled_plan_id
      ? await this.store.db.$queryRaw<{ name: string; code: string }[]>(
          Prisma.sql`SELECT v.name, p.code::text FROM workspace_plans p JOIN LATERAL (${ON_SALE_VERSION}) v ON true
            WHERE p.id = ${open.row.scheduled_plan_id}::uuid`,
        )
      : [];
    return {
      state: open?.state ?? 'FREE',
      entitlementSource: effective.source,
      plan: { id: effective.plan_id, code: effective.plan_code, name: effective.plan_name, versionId: effective.plan_version_id },
      entitlements: entitlementsOf(effective),
      subscription: open && {
        id: open.row.id,
        planId: open.row.plan_id,
        planName: open.row.plan_name,
        billingCycle: open.row.billing_cycle,
        priceVnd: open.row.price_vnd,
        protectedEntitlements: entitlementsOf(open.row),
        termsVersion: open.row.terms_version,
        startedAt: open.row.created_at,
        currentPeriod: open.covering ? { startsAt: open.covering.starts_at, endsAt: open.covering.ends_at } : null,
        paidThrough: open.paidThrough,
        graceEndsAt: open.paidThrough ? graceEnd(open.paidThrough, settings.grace_days) : null,
        cancelAtPeriodEnd: open.row.cancel_at_period_end,
        renewable: renewable(open.state),
        hasQueuedTerm: open.terms.some((t) => t.starts_at > now),
        scheduledChange: open.row.scheduled_plan_id && {
          planId: open.row.scheduled_plan_id,
          planName: scheduled[0]?.name ?? null,
          billingCycle: open.row.scheduled_cycle,
        },
        suspendedReason: open.row.suspended_reason,
      },
      pendingOrder: pending ? orderView(pending) : null,
      policy: { graceDays: settings.grace_days, renewalReminderDays: settings.renewal_reminder_days, autoRenew: false },
    };
  }

  async quote(userId: string, dto: QuoteDto) {
    return this.store.transaction(async (tx) => {
      const quote = await this.buildQuote(tx, userId, dto, new Date());
      return quote;
    });
  }

  async orderList(userId: string, page: number) {
    const [rows, [count]] = await Promise.all([
      this.store.db.$queryRaw<OrderRow[]>`SELECT * FROM workspace_orders WHERE buyer_id = ${userId}::uuid
        ORDER BY created_at DESC LIMIT 20 OFFSET ${(page - 1) * 20}`,
      this.store.db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM workspace_orders WHERE buyer_id = ${userId}::uuid`,
    ]);
    return { items: rows.map(orderView), total: Number(count.total), page, limit: 20 };
  }

  async order(userId: string | null, id: string) {
    const [row] = await this.store.db.$queryRaw<(OrderRow & { provider: string; payment_status: string; checkout_url: string | null })[]>`
      SELECT o.*, p.provider, p.status AS payment_status, p.checkout_url FROM workspace_orders o
      JOIN commerce_payments p ON p.workspace_order_id = o.id
      WHERE o.id = ${id}::uuid AND (${userId}::uuid IS NULL OR o.buyer_id = ${userId}::uuid)`;
    if (!row) throw new NotFound('Workspace order', id);
    return {
      ...orderView(row),
      payment: { provider: row.provider, status: row.payment_status, checkoutUrl: row.status === 'pending' ? row.checkout_url : null },
    };
  }

  // ---------------------------------------------------------------- checkout

  async checkout(userId: string, dto: CheckoutDto) {
    this.providers.assertEnabled();
    if (!this.providers.methods().includes(dto.provider))
      throw new BadRequestException('This payment method is not available.');
    const orderId = await this.store.transaction(async (tx) => {
      await lock(tx, `ws-billing:${userId}`);
      await this.expireStaleOrders(tx, userId);
      const quote = await this.buildQuote(tx, userId, dto, new Date());
      if (quote.change !== 'new' && quote.change !== 'renewal' && quote.change !== 'upgrade')
        throw new BusinessRuleViolation('Downgrades and billing-cycle changes are scheduled, not paid now.', {
          code: BILLING_CODES.planChangeConflict,
          change: quote.change,
        });
      const snapshot = quote.snapshot!;
      if (snapshot.amountVnd !== dto.expectedAmountVnd)
        throw new BusinessRuleViolation('The price changed. Review the new quote before paying.', {
          code: BILLING_CODES.priceChanged,
          amountVnd: snapshot.amountVnd,
        });
      const [open] = await tx.$queryRaw<(OrderRow & { create_started_at: Date | null })[]>`
        SELECT o.*, p.create_started_at FROM workspace_orders o JOIN commerce_payments p ON p.workspace_order_id = o.id
        WHERE o.buyer_id = ${userId}::uuid AND o.status = 'pending' FOR UPDATE OF o`;
      if (open) {
        const same =
          open.plan_version_id === snapshot.plan.versionId &&
          open.billing_cycle === snapshot.billingCycle &&
          open.amount_vnd === snapshot.amountVnd &&
          open.kind === snapshot.kind;
        if (same) return open.id;
        // A payment page may already be open at the gateway: money could still arrive for it.
        if (open.create_started_at)
          throw new BusinessRuleViolation('Finish or wait for your open payment before starting another.', {
            code: BILLING_CODES.planChangeConflict,
            pendingOrderId: open.id,
            expiresAt: open.expires_at,
          });
        await this.closeOrder(tx, open.id, 'cancelled', userId);
      }
      const [order] = await tx.$queryRaw<OrderRow[]>`
        INSERT INTO workspace_orders(buyer_id, kind, plan_id, plan_version_id, billing_cycle, subscription_id,
          list_price_vnd, discount_vnd, credit_vnd, amount_vnd, coupon_id, quote, mode)
        VALUES (${userId}::uuid, ${snapshot.kind}, ${snapshot.plan.id}::uuid, ${snapshot.plan.versionId}::uuid,
          ${snapshot.billingCycle}, ${quote.subscriptionId}::uuid, ${snapshot.listPriceVnd}, ${snapshot.discountVnd},
          ${snapshot.creditVnd}, ${snapshot.amountVnd}, ${snapshot.coupon?.id ?? null}::uuid,
          ${JSON.stringify(snapshot)}::jsonb, ${this.providers.mode})
        RETURNING *`;
      if (snapshot.coupon)
        await tx.$executeRaw`INSERT INTO workspace_coupon_redemptions(coupon_id, order_id, user_id)
          VALUES (${snapshot.coupon.id}::uuid, ${order.id}::uuid, ${userId}::uuid)`;
      await tx.$executeRaw`INSERT INTO commerce_payments(workspace_order_id, provider) VALUES (${order.id}::uuid, ${dto.provider})`;
      await audit(tx, 'workspace_order.created', order.id, userId, { kind: snapshot.kind, amountVnd: snapshot.amountVnd });
      return order.id;
    });
    await this.startPayment(orderId);
    return this.order(userId, orderId);
  }

  /** Claims the provider call once; an unknown outcome is queried with the SAME payment id. */
  private async startPayment(orderId: string) {
    const [payment] = await this.store.db.$queryRaw<(PaymentRow & { amount_vnd: number; expires_at: Date })[]>`
      UPDATE commerce_payments p SET create_started_at = now()
      FROM workspace_orders o
      WHERE p.workspace_order_id = ${orderId}::uuid AND o.id = p.workspace_order_id
        AND p.create_started_at IS NULL AND p.status = 'pending'
      RETURNING p.*, o.amount_vnd, o.expires_at`;
    if (!payment) return;
    try {
      const url = await this.providers.create(payment.provider, {
        id: payment.id,
        orderId,
        amount: payment.amount_vnd,
        createdAt: payment.created_at,
        expiresAt: payment.expires_at,
        returnPath: `${RESULT_PATH}?order=${orderId}`,
      });
      await this.store.db.$executeRaw`UPDATE commerce_payments SET checkout_url = ${url} WHERE id = ${payment.id}::uuid`;
    } catch {
      await this.store.db.$executeRaw`UPDATE commerce_payments SET status = 'unknown' WHERE id = ${payment.id}::uuid AND status = 'pending'`;
    }
  }

  // ------------------------------------------------------------ plan changes

  async cancelRenewal(userId: string) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-billing:${userId}`);
      const open = await this.openSubscription(tx, userId, new Date());
      if (!open || open.state !== 'ACTIVE') throw new BusinessRuleViolation('There is no active subscription to cancel.');
      await tx.$executeRaw`UPDATE workspace_subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = ${open.row.id}::uuid`;
      await audit(tx, 'workspace_subscription.cancel_scheduled', open.row.id, userId, { paidThrough: open.paidThrough });
      return { cancelAtPeriodEnd: true, benefitsEndAt: open.paidThrough };
    });
  }

  async resumeRenewal(userId: string) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-billing:${userId}`);
      const open = await this.openSubscription(tx, userId, new Date());
      if (!open || open.state !== 'CANCEL_SCHEDULED') throw new BusinessRuleViolation('Renewal is not cancelled.');
      await tx.$executeRaw`UPDATE workspace_subscriptions SET cancel_at_period_end = false, scheduled_plan_id = NULL,
        scheduled_cycle = NULL, updated_at = now() WHERE id = ${open.row.id}::uuid`;
      await audit(tx, 'workspace_subscription.cancel_reverted', open.row.id, userId);
      return { cancelAtPeriodEnd: false };
    });
  }

  /** Downgrade or cycle change: current benefits continue until the paid period ends. */
  async scheduleChange(userId: string, dto: ScheduleChangeDto) {
    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-billing:${userId}`);
      const now = new Date();
      const open = await this.openSubscription(tx, userId, now);
      if (!open || (open.state !== 'ACTIVE' && open.state !== 'CANCEL_SCHEDULED'))
        throw new BusinessRuleViolation('Only an active subscription can schedule a change.');
      const [current] = await tx.$queryRaw<PlanRow[]>`SELECT * FROM workspace_plans WHERE id = ${open.row.plan_id}::uuid`;
      const target = await this.saleablePlan(tx, dto.planId);
      const change = classifyChange(
        { planId: current.id, sortOrder: current.sort_order, cycle: open.row.billing_cycle },
        { planId: target.plan.id, sortOrder: target.plan.sort_order, cycle: dto.billingCycle },
      );
      if (change !== 'downgrade' && change !== 'cycle_change')
        throw new BusinessRuleViolation('Upgrades and renewals are paid now, not scheduled.', { code: BILLING_CODES.planChangeConflict, change });
      if (!target.plan.is_default && priceFor(pricesOf(target.version), dto.billingCycle) === null)
        throw new BusinessRuleViolation('This plan is not offered for that billing period.');
      const scheduledPlan = target.plan.is_default ? null : target.plan.id;
      await tx.$executeRaw`UPDATE workspace_subscriptions SET cancel_at_period_end = true,
        scheduled_plan_id = ${scheduledPlan}::uuid, scheduled_cycle = ${scheduledPlan ? dto.billingCycle : null},
        updated_at = now() WHERE id = ${open.row.id}::uuid`;
      await audit(tx, 'workspace_subscription.change_scheduled', open.row.id, userId, {
        to: { planId: target.plan.id, billingCycle: dto.billingCycle },
        effectiveAt: open.paidThrough,
      });
      return { change, effectiveAt: open.paidThrough, to: { planId: target.plan.id, name: target.version.name, billingCycle: dto.billingCycle } };
    });
  }

  // ------------------------------------------------------------------ quote

  private async buildQuote(tx: Tx, userId: string, dto: QuoteDto, now: Date) {
    const open = await this.openSubscription(tx, userId, now);
    if (open?.state === 'SUSPENDED')
      throw new BusinessRuleViolation('Your Workspace subscription is suspended. Contact support.', { code: 'WORKSPACE_SUBSCRIPTION_SUSPENDED' });
    if (open && renewable(open.state) && open.row.plan_id === dto.planId && open.row.billing_cycle === dto.billingCycle)
      return this.renewalQuote(open, dto, now);
    const target = await this.saleablePlan(tx, dto.planId);
    const [{ terms_version: termsVersion }] = await tx.$queryRaw<{ terms_version: string }[]>`SELECT terms_version FROM workspace_billing_settings`;
    const alive = open && renewable(open.state) ? open : null;
    const [currentPlan] = alive
      ? await tx.$queryRaw<PlanRow[]>`SELECT * FROM workspace_plans WHERE id = ${alive.row.plan_id}::uuid`
      : [];
    const change = target.plan.is_default
      ? alive ? 'downgrade' : 'new'
      : classifyChange(
          alive ? { planId: alive.row.plan_id, sortOrder: currentPlan.sort_order, cycle: alive.row.billing_cycle } : null,
          { planId: target.plan.id, sortOrder: target.plan.sort_order, cycle: dto.billingCycle },
        );
    const current = alive && { subscriptionId: alive.row.id, planName: alive.row.plan_name, entitlements: entitlementsOf(alive.row), paidThrough: alive.paidThrough, state: alive.state };
    const preview = { change, current, target: { planId: target.plan.id, name: target.version.name, entitlements: entitlementsOf(target.version) } };
    if (target.plan.is_default || change === 'downgrade' || change === 'cycle_change')
      return { ...preview, subscriptionId: null, snapshot: null, effectiveAt: alive?.paidThrough ?? now };
    if (!target.plan.is_purchasable) throw new BusinessRuleViolation('This plan is not on sale.');

    const listPrice = priceFor(pricesOf(target.version), dto.billingCycle);
    if (listPrice === null) throw new BusinessRuleViolation('This plan is not offered for that billing period.');
    let credit: QuoteSnapshot['credit'] = null;
    if (change === 'upgrade' && alive?.covering) {
      // Unused part of the current term plus any period already paid in advance.
      const paid = alive.terms
        .filter((t) => t.ends_at > now)
        .reduce((sum, t) => sum + (t.id === alive.covering!.id ? prorationCredit(t.amount_vnd, t.starts_at, t.ends_at, now) : t.amount_vnd), 0);
      credit = { subscriptionId: alive.row.id, termStart: alive.covering.starts_at.toISOString(), termEnd: alive.covering.ends_at.toISOString(), paidVnd: paid };
    }
    const coupon = dto.couponCode ? await this.eligibleCoupon(tx, userId, dto.couponCode, target.plan.id, dto.billingCycle, now) : null;
    const discount = coupon ? couponDiscount(coupon, listPrice) : 0;
    const creditVnd = Math.min(credit?.paidVnd ?? 0, listPrice - discount);
    const amount = listPrice - discount - creditVnd;
    if (amount < MIN_CHARGE_VND)
      throw new BusinessRuleViolation('Your unused credit covers this change. Choose annual billing or contact support.', {
        code: BILLING_CODES.planChangeConflict,
        creditVnd,
      });
    const snapshot: QuoteSnapshot = {
      kind: change as 'new' | 'upgrade',
      plan: { id: target.plan.id, code: target.plan.code, name: target.version.name, versionId: target.version.id, version: target.version.version },
      billingCycle: dto.billingCycle,
      entitlements: entitlementsOf(target.version),
      listPriceVnd: listPrice,
      discountVnd: discount,
      creditVnd,
      amountVnd: amount,
      coupon: coupon && { id: coupon.id, code: coupon.code, kind: coupon.kind, value: coupon.value },
      credit: credit && { ...credit, paidVnd: creditVnd },
      startsAt: now.toISOString(),
      termsVersion,
      quotedAt: now.toISOString(),
    };
    return {
      ...preview,
      subscriptionId: change === 'new' ? null : alive!.row.id,
      snapshot,
      effectiveAt: now,
      endsAt: addBillingPeriod(now, dto.billingCycle),
    };
  }

  /** Protected contract: same price and limits as purchased, whatever the plan says now. */
  private renewalQuote(sub: OpenSubscription, dto: QuoteDto, now: Date) {
    if (sub.terms.some((t) => t.starts_at > now))
      throw new BusinessRuleViolation('The next period is already paid.', { code: BILLING_CODES.planChangeConflict });
    if (dto.couponCode)
      throw new BusinessRuleViolation('Coupons apply to new plans and upgrades, not renewals.', { code: BILLING_CODES.couponInvalid });
    const startsAt = sub.paidThrough && sub.paidThrough > now ? sub.paidThrough : now;
    const entitlements = entitlementsOf(sub.row);
    const snapshot: QuoteSnapshot = {
      ...sub.row.snapshot,
      kind: 'renewal',
      entitlements,
      listPriceVnd: sub.row.price_vnd,
      discountVnd: 0,
      creditVnd: 0,
      amountVnd: sub.row.price_vnd,
      coupon: null,
      credit: null,
      startsAt: startsAt.toISOString(),
      termsVersion: sub.row.terms_version,
      quotedAt: now.toISOString(),
    };
    const current = { subscriptionId: sub.row.id, planName: sub.row.plan_name, entitlements, paidThrough: sub.paidThrough, state: sub.state };
    return {
      change: 'renewal' as const,
      current,
      target: { planId: sub.row.plan_id, name: sub.row.plan_name, entitlements },
      subscriptionId: sub.row.id,
      snapshot,
      effectiveAt: startsAt,
      endsAt: addBillingPeriod(startsAt, sub.row.billing_cycle),
    };
  }

  private async saleablePlan(tx: Tx, planId: string) {
    const [row] = await tx.$queryRaw<(PlanRow & { v: VersionRow })[]>(
      Prisma.sql`SELECT p.*, to_jsonb(v) AS v FROM workspace_plans p JOIN LATERAL (${ON_SALE_VERSION}) v ON true
        WHERE p.id = ${planId}::uuid AND p.status = 'active'`,
    );
    if (!row) throw new NotFound('Workspace plan', planId);
    const { v, ...plan } = row;
    return { plan: plan as PlanRow, version: { ...v, max_storage_bytes: BigInt(v.max_storage_bytes), max_upload_bytes: BigInt(v.max_upload_bytes) } as VersionRow };
  }

  private async eligibleCoupon(tx: Tx, userId: string, code: string, planId: string, cycle: BillingCycle, now: Date) {
    const [coupon] = await tx.$queryRaw<CouponRow[]>`SELECT * FROM workspace_coupons WHERE code = ${code} FOR UPDATE`;
    const invalid = (message: string) => new BusinessRuleViolation(message, { code: BILLING_CODES.couponInvalid });
    if (!coupon || !coupon.is_active) throw invalid('This coupon does not exist.');
    if (now < coupon.starts_at || now >= coupon.ends_at) throw invalid('This coupon is not valid at this time.');
    if (coupon.plan_ids?.length && !coupon.plan_ids.includes(planId)) throw invalid('This coupon does not apply to this plan.');
    if (coupon.billing_cycles?.length && !coupon.billing_cycles.includes(cycle)) throw invalid('This coupon does not apply to this billing period.');
    const [usage] = await tx.$queryRaw<{ total: bigint; mine: bigint; paid_before: boolean }[]>`
      SELECT count(*) FILTER (WHERE r.status <> 'released') AS total,
        count(*) FILTER (WHERE r.status <> 'released' AND r.user_id = ${userId}::uuid) AS mine,
        EXISTS (SELECT 1 FROM workspace_orders o WHERE o.buyer_id = ${userId}::uuid AND o.status = 'paid') AS paid_before
      FROM workspace_coupon_redemptions r WHERE r.coupon_id = ${coupon.id}::uuid`;
    if (coupon.max_redemptions !== null && Number(usage.total) >= coupon.max_redemptions) throw invalid('This coupon has been fully redeemed.');
    if (Number(usage.mine) >= coupon.per_user_limit) throw invalid('You have already used this coupon.');
    if (coupon.new_customers_only && usage.paid_before) throw invalid('This coupon is for new subscribers only.');
    return coupon;
  }

  // ---------------------------------------------------------------- payment

  /**
   * Same guarantees as course payments: amount and environment must match the frozen order,
   * one provider event is applied once, and a late success is kept for review, never lost.
   */
  async applyPayment(provider: PaymentProvider, e: PaymentEvidence, reconciled = false) {
    this.providers.assertEnabled();
    if (!Number.isSafeInteger(e.amount) || e.amount <= 0 || (!e.reference && e.result === 'success'))
      throw new BadRequestException('Invalid payment result');
    const [payment] = await this.store.db.$queryRaw<PaymentRow[]>`
      SELECT * FROM commerce_payments WHERE id = ${e.paymentId}::uuid AND provider = ${provider} AND workspace_order_id IS NOT NULL`;
    if (!payment) throw new NotFoundException('Payment not found');
    const [frozen] = await this.store.db.$queryRaw<OrderRow[]>`SELECT * FROM workspace_orders WHERE id = ${payment.workspace_order_id}::uuid`;
    if (frozen.amount_vnd !== e.amount || (provider === 'mock') !== (frozen.mode === 'mock'))
      throw new BadRequestException('Amount or environment mismatch');

    return this.store.transaction(async (tx) => {
      await lock(tx, `ws-billing:${frozen.buyer_id}`);
      const [order] = await tx.$queryRaw<OrderRow[]>`SELECT * FROM workspace_orders WHERE id = ${frozen.id}::uuid FOR UPDATE`;
      const [current] = await tx.$queryRaw<PaymentRow[]>`SELECT * FROM commerce_payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      if (e.result === 'success') {
        await lock(tx, `provider-reference:${provider}:${e.reference}`);
        const [duplicate] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce_payments
          WHERE provider = ${provider} AND provider_ref = ${e.reference} AND id <> ${payment.id}::uuid`;
        if (duplicate || (current.provider_ref && current.provider_ref !== e.reference)) {
          await audit(tx, 'workspace_payment.reference_conflict', order.id, undefined, { provider, reference: e.reference });
          return { quarantined: true };
        }
      }
      const events = await tx.$queryRaw<{ id: string }[]>`INSERT INTO commerce_provider_events(payment_id, fingerprint, result)
        VALUES (${payment.id}::uuid, ${e.fingerprint}, ${e.result}) ON CONFLICT DO NOTHING RETURNING id`;
      if (!events.length || current.status === 'succeeded') {
        if (reconciled && e.result === 'success' && current.status === 'succeeded')
          await tx.$executeRaw`UPDATE commerce_payments SET reconciled_at = now() WHERE id = ${payment.id}::uuid`;
        return { duplicate: true };
      }
      if (e.result === 'success') {
        await tx.$executeRaw`UPDATE commerce_payments SET status = 'succeeded', provider_ref = ${e.reference},
          reconciled_at = ${reconciled || provider === 'mock' ? new Date() : null} WHERE id = ${payment.id}::uuid`;
        // Recorded once, review or not: the money arrived either way.
        await journal(tx, `payment:${payment.id}`, [
          { account: 'clearing', amount: -order.amount_vnd },
          { account: 'platform', amount: order.amount_vnd },
        ], { workspaceOrder: order.id });
        await this.activateOrReview(tx, order, provider, e.reference);
      } else if (order.status === 'pending' && (e.result === 'failure' || e.result === 'cancelled')) {
        await tx.$executeRaw`UPDATE commerce_payments SET status = ${e.result === 'failure' ? 'failed' : 'cancelled'} WHERE id = ${payment.id}::uuid`;
        await this.closeOrder(tx, order.id, e.result === 'failure' ? 'failed' : 'cancelled');
      } else if (order.status === 'pending' && e.result === 'unknown') {
        await tx.$executeRaw`UPDATE commerce_payments SET status = 'unknown' WHERE id = ${payment.id}::uuid AND status = 'pending'`;
      }
      return {};
    });
  }

  private async activateOrReview(tx: Tx, order: OrderRow, provider: PaymentProvider, reference: string) {
    const now = new Date();
    const snapshot = order.quote;
    const open = await this.openSubscription(tx, order.buyer_id, now);
    const reviewReason =
      order.status !== 'pending' ? 'payment arrived after the order closed'
      // A renewal ordered during grace stays valid even if the gateway confirms after grace ends.
      : order.kind === 'renewal' && (!open || open.row.id !== order.subscription_id || open.state === 'SUSPENDED') ? 'subscription can no longer be renewed'
      : order.kind === 'upgrade' && (!open || open.row.id !== order.subscription_id) ? 'subscription changed before payment'
      : order.kind === 'new' && open && (open.state === 'ACTIVE' || open.state === 'CANCEL_SCHEDULED') ? 'another subscription is already active'
      : null;
    if (reviewReason) {
      // Real money arrived for terms we can no longer honour: keep it for an administrator to
      // refund or grant. Never silently stack or merge entitlements.
      await tx.$executeRaw`UPDATE workspace_orders SET status = 'review' WHERE id = ${order.id}::uuid`;
      await this.releaseCoupon(tx, order.id);
      await audit(tx, 'workspace_payment.review', order.id, undefined, { provider, reference, reason: reviewReason });
      await notifyCommerce(tx, order.buyer_id, order.id, 'Payment needs review',
        'We received your payment but could not apply it automatically. An administrator will review it.',
        `${RESULT_PATH}?order=${order.id}`);
      return;
    }

    let subscriptionId: string;
    let startsAt = now;
    if (order.kind === 'renewal') {
      subscriptionId = order.subscription_id!;
      startsAt = open!.paidThrough && open!.paidThrough > now ? open!.paidThrough : now;
      await tx.$executeRaw`UPDATE workspace_subscriptions SET cancel_at_period_end = false, scheduled_plan_id = NULL,
        scheduled_cycle = NULL, updated_at = now() WHERE id = ${subscriptionId}::uuid`;
    } else {
      if (open)
        await tx.$executeRaw`UPDATE workspace_subscriptions SET ended_at = ${now},
          end_reason = ${order.kind === 'upgrade' ? 'upgraded' : open.state === 'EXPIRED' ? 'expired' : 'replaced'},
          updated_at = now() WHERE id = ${open.row.id}::uuid`;
      const ent = snapshot.entitlements;
      const [created] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO workspace_subscriptions(user_id, plan_id, plan_version_id, billing_cycle, price_vnd, plan_name,
          max_owned_groups, max_members_per_group, max_storage_bytes, max_upload_bytes, monthly_ai_requests, features,
          terms_version, snapshot)
        VALUES (${order.buyer_id}::uuid, ${order.plan_id}::uuid, ${order.plan_version_id}::uuid, ${order.billing_cycle},
          ${order.list_price_vnd}, ${snapshot.plan.name}, ${ent.maxOwnedGroups}, ${ent.maxMembersPerGroup}::integer,
          ${BigInt(ent.maxStorageBytes)}, ${BigInt(ent.maxUploadBytes)}, ${ent.monthlyAiRequests}, ${ent.features}::text[],
          ${snapshot.termsVersion}, ${JSON.stringify({ ...snapshot, orderId: order.id })}::jsonb)
        RETURNING id`;
      subscriptionId = created.id;
    }
    const endsAt = addBillingPeriod(startsAt, order.billing_cycle);
    await tx.$executeRaw`INSERT INTO workspace_subscription_terms(subscription_id, order_id, starts_at, ends_at)
      VALUES (${subscriptionId}::uuid, ${order.id}::uuid, ${startsAt}, ${endsAt})`;
    await tx.$executeRaw`UPDATE workspace_orders SET status = 'paid', paid_at = now(), result_subscription_id = ${subscriptionId}::uuid
      WHERE id = ${order.id}::uuid`;
    await tx.$executeRaw`UPDATE workspace_coupon_redemptions SET status = 'redeemed' WHERE order_id = ${order.id}::uuid`;
    await audit(tx, `workspace_subscription.${order.kind === 'renewal' ? 'renewed' : order.kind === 'upgrade' ? 'upgraded' : 'activated'}`,
      subscriptionId, order.buyer_id, { orderId: order.id, provider, reference, startsAt, endsAt });
    await notifyCommerce(tx, order.buyer_id, order.id,
      order.kind === 'renewal' ? 'Workspace plan renewed' : `${snapshot.plan.name} is active`,
      `Your Workspace ${snapshot.plan.name} plan is paid through ${endsAt.toISOString().slice(0, 10)}.`,
      '/workspace/billing');
  }

  async mock(userId: string, orderId: string, result: 'success' | 'failure' | 'cancelled' | 'pending' | 'unknown') {
    this.providers.assertMock();
    const detail = await this.order(userId, orderId);
    if (detail.payment.provider !== 'mock') throw new BadRequestException();
    const [payment] = await this.store.db.$queryRaw<{ id: string }[]>`SELECT id FROM commerce_payments WHERE workspace_order_id = ${orderId}::uuid`;
    await this.applyPayment('mock', {
      paymentId: payment.id,
      amount: detail.amountVnd,
      reference: `mock-${payment.id}`,
      result,
      fingerprint: `mock:${payment.id}:${result}`,
    }, true);
    return this.order(userId, orderId);
  }

  /** Asks the gateway for the real outcome; never trusts the browser's return URL. */
  async reconcile(orderId: string) {
    const [row] = await this.store.db.$queryRaw<(PaymentRow & { amount_vnd: number; expires_at: Date })[]>`
      SELECT p.*, o.amount_vnd, o.expires_at FROM commerce_payments p JOIN workspace_orders o ON o.id = p.workspace_order_id
      WHERE o.id = ${orderId}::uuid`;
    if (!row) throw new NotFound('Workspace order', orderId);
    if (row.provider === 'mock' || !row.create_started_at) return;
    const evidence = await this.providers.query(row.provider, {
      id: row.id,
      orderId,
      amount: row.amount_vnd,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
    if (!evidence) return;
    if (evidence.paymentId !== row.id) throw new ConflictException('Payment reference mismatch');
    await this.applyPayment(row.provider, { ...evidence, fingerprint: `query:${evidence.fingerprint}` }, true);
  }

  // ---------------------------------------------------------------- helpers

  private async expireStaleOrders(tx: Tx, userId: string) {
    const stale = await tx.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM workspace_orders o JOIN commerce_payments p ON p.workspace_order_id = o.id
      WHERE o.buyer_id = ${userId}::uuid AND o.status = 'pending' AND o.expires_at <= now()`;
    for (const { id } of stale) await this.closeOrder(tx, id, 'expired');
  }

  private async closeOrder(tx: Tx, orderId: string, status: 'expired' | 'cancelled' | 'failed', actorId?: string) {
    await tx.$executeRaw`UPDATE workspace_orders SET status = ${status} WHERE id = ${orderId}::uuid AND status = 'pending'`;
    await this.releaseCoupon(tx, orderId);
    await audit(tx, `workspace_order.${status}`, orderId, actorId);
  }

  private async releaseCoupon(tx: Tx, orderId: string) {
    await tx.$executeRaw`UPDATE workspace_coupon_redemptions SET status = 'released' WHERE order_id = ${orderId}::uuid AND status = 'reserved'`;
  }

  async openSubscription(tx: Tx, userId: string, now: Date): Promise<OpenSubscription | null> {
    const [row] = await tx.$queryRaw<SubscriptionRow[]>`
      SELECT * FROM workspace_subscriptions WHERE user_id = ${userId}::uuid AND ended_at IS NULL`;
    if (!row) return null;
    const terms = await tx.$queryRaw<TermRow[]>`
      SELECT t.id, t.order_id, t.starts_at, t.ends_at, o.amount_vnd FROM workspace_subscription_terms t
      JOIN workspace_orders o ON o.id = t.order_id WHERE t.subscription_id = ${row.id}::uuid ORDER BY t.starts_at`;
    const [{ grace_days: graceDays }] = await tx.$queryRaw<{ grace_days: number }[]>`SELECT grace_days FROM workspace_billing_settings`;
    const paidThrough = terms.length ? terms[terms.length - 1].ends_at : null;
    const covering = terms.find((t) => t.starts_at <= now && t.ends_at > now) ?? null;
    const state = subscriptionState(
      { paidThrough, covered: !!covering, cancelAtPeriodEnd: row.cancel_at_period_end, suspended: !!row.suspended_at, graceDays },
      now,
    );
    return { row, terms, paidThrough, covering, state };
  }
}
