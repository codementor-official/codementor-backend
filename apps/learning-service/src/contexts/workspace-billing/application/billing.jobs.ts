import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CommerceStore, audit, lock } from '../../commerce/infrastructure/commerce.store';
import { notifyCommerce } from '../../commerce/infrastructure/commerce-notification';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Housekeeping only. Entitlements are derived from timestamps, so a late or skipped run never
 * grants or removes access; it only delays reconciliation and reminders.
 */
@Injectable()
export class BillingJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly logger = new Logger(BillingJobs.name);

  constructor(
    private readonly store: CommerceStore,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  onModuleInit() {
    // Same switch as course commerce jobs: off in production unless explicitly enabled.
    if (process.env.COMMERCE_JOBS_ENABLED === 'false' ||
      (process.env.NODE_ENV === 'production' && process.env.COMMERCE_JOBS_ENABLED !== 'true')) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.busy) return { skipped: true };
    this.busy = true;
    const result = { reconciled: 0, expired: 0, reminders: 0, graceNotices: 0, overageNotices: 0, failures: 0 };
    try {
      await this.reconcilePayments(result);
      result.expired = await this.expireOrders();
      result.reminders = await this.renewalReminders();
      result.graceNotices = await this.graceNotices();
      result.overageNotices = await this.overageNotices();
    } catch (error) {
      result.failures++;
      this.logger.warn(`Workspace billing job failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
    return result;
  }

  /** Payments whose outcome is not yet verified with the gateway, newest week only. */
  private async reconcilePayments(result: { reconciled: number; failures: number }) {
    const rows = await this.store.db.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM workspace_orders o JOIN commerce_payments p ON p.workspace_order_id = o.id
      LEFT JOIN commerce_provider_query_leases ql ON ql.payment_id = p.id
      WHERE p.provider <> 'mock' AND p.create_started_at IS NOT NULL
        AND (p.reconciled_at IS NULL OR p.status = 'pending')
        AND (p.provider <> 'vnpay' OR ql.next_query_at IS NULL OR ql.next_query_at <= now())
        AND o.created_at > now() - interval '7 days'
      ORDER BY o.created_at LIMIT 20`;
    for (const { id } of rows) {
      try {
        await this.subscriptions.reconcile(id);
        result.reconciled++;
      } catch {
        result.failures++;
        this.logger.warn(`Workspace payment reconciliation needs review: order=${id}`);
      }
    }
  }

  private async expireOrders() {
    return this.store.transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE workspace_orders SET status = 'expired' WHERE status = 'pending' AND expires_at <= now() RETURNING id`;
      if (!rows.length) return 0;
      await tx.$executeRaw`UPDATE workspace_coupon_redemptions SET status = 'released'
        WHERE status = 'reserved' AND order_id = ANY(${rows.map((r) => r.id)}::uuid[])`;
      return rows.length;
    });
  }

  /** One reminder per paid period, sent when the period is about to end and nothing follows it. */
  private async renewalReminders() {
    const due = await this.store.db.$queryRaw<{ id: string; user_id: string; plan_name: string; paid_through: Date }[]>`
      SELECT s.id, s.user_id, s.plan_name, t.paid_through FROM workspace_subscriptions s
      JOIN LATERAL (SELECT max(ends_at) AS paid_through FROM workspace_subscription_terms WHERE subscription_id = s.id) t ON true
      WHERE s.ended_at IS NULL AND s.suspended_at IS NULL AND NOT s.cancel_at_period_end
        AND t.paid_through > now()
        AND t.paid_through <= now() + make_interval(days => (SELECT renewal_reminder_days FROM workspace_billing_settings))
        AND NOT EXISTS (SELECT 1 FROM commerce_audit a WHERE a.action = 'workspace_subscription.renewal_reminder'
          AND a.entity_id = s.id AND a.details->>'paidThrough' = to_char(t.paid_through AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      LIMIT 100`;
    for (const s of due)
      await this.notifyOnce(s.id, s.user_id, 'workspace_subscription.renewal_reminder', s.paid_through,
        `Gói ${s.plan_name} sắp hết hạn`,
        `Gói có hiệu lực đến ${vnDate(s.paid_through)}. Gia hạn trước ngày này để giữ hạn mức và giá đã ký.`);
    return due.length;
  }

  /** Tells the owner once that the period ended and the grace period started. */
  private async graceNotices() {
    const due = await this.store.db.$queryRaw<{ id: string; user_id: string; plan_name: string; paid_through: Date }[]>`
      SELECT s.id, s.user_id, s.plan_name, t.paid_through FROM workspace_subscriptions s
      JOIN LATERAL (SELECT max(ends_at) AS paid_through FROM workspace_subscription_terms WHERE subscription_id = s.id) t ON true
      WHERE s.ended_at IS NULL AND s.suspended_at IS NULL AND NOT s.cancel_at_period_end
        AND t.paid_through <= now()
        AND now() < t.paid_through + make_interval(days => (SELECT grace_days FROM workspace_billing_settings))
        AND NOT EXISTS (SELECT 1 FROM commerce_audit a WHERE a.action = 'workspace_subscription.grace_notice'
          AND a.entity_id = s.id AND a.details->>'paidThrough' = to_char(t.paid_through AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      LIMIT 100`;
    for (const s of due)
      await this.notifyOnce(s.id, s.user_id, 'workspace_subscription.grace_notice', s.paid_through,
        `Gói ${s.plan_name} đã hết kỳ thanh toán`,
        'Nhóm và tài liệu của bạn vẫn được giữ nguyên. Gia hạn trong thời gian ân hạn để giữ hạn mức của gói.');
    return due.length;
  }

  /**
   * One message per stage of an over-limit episode (`workspace_owner_overage`, kept by
   * workspace-service): when it starts, when groups turn read-only, when they are hidden.
   */
  private async overageNotices() {
    const due = await this.store.db.$queryRaw<{ owner_id: string; over_since: Date; stage: string; read_only_at: Date; hidden_at: Date }[]>`
      WITH o AS (
        SELECT o.owner_id, o.over_since,
          o.over_since + make_interval(days => s.overage_notice_days) AS read_only_at,
          o.over_since + make_interval(days => s.overage_notice_days + s.overage_read_only_days) AS hidden_at
        FROM workspace_owner_overage o CROSS JOIN workspace_billing_settings s)
      SELECT owner_id, over_since, read_only_at, hidden_at,
        CASE WHEN now() >= hidden_at THEN 'hidden' WHEN now() >= read_only_at THEN 'read_only' ELSE 'notice' END AS stage
      FROM o WHERE NOT EXISTS (SELECT 1 FROM commerce_audit a WHERE a.action = 'workspace_subscription.overage_notice'
        AND a.entity_id = o.owner_id
        AND a.details->>'overSince' = to_char(o.over_since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        AND a.details->>'stage' = CASE WHEN now() >= hidden_at THEN 'hidden' WHEN now() >= read_only_at THEN 'read_only' ELSE 'notice' END)
      LIMIT 100`;
    const text: Record<string, (r: (typeof due)[number]) => [string, string]> = {
      notice: (r) => ['Workspace đang vượt hạn mức gói', `Nâng cấp gói hoặc dọn dẹp trước ${vnDate(r.read_only_at)}; sau ngày này các nhóm vượt hạn mức chuyển sang chỉ đọc.`],
      read_only: (r) => ['Một số nhóm đã chuyển sang chỉ đọc', `Thành viên vẫn xem được tài liệu nhưng không thêm nội dung mới. Từ ${vnDate(r.hidden_at)} các nhóm này sẽ tạm ẩn với thành viên.`],
      hidden: () => ['Một số nhóm đã tạm ẩn với thành viên', 'Dữ liệu vẫn được giữ nguyên. Nâng cấp gói hoặc dọn dẹp để mở lại ngay.'],
    };
    for (const r of due) {
      const [title, message] = text[r.stage](r);
      await this.notifyOnce(r.owner_id, r.owner_id, 'workspace_subscription.overage_notice', r.over_since, title, message, { stage: r.stage });
    }
    return due.length;
  }

  private async notifyOnce(
    entityId: string,
    userId: string,
    action: string,
    since: Date,
    title: string,
    message: string,
    extra: Record<string, string> = {},
  ) {
    const key = action.endsWith('overage_notice') ? 'overSince' : 'paidThrough';
    await this.store.transaction(async (tx) => {
      await lock(tx, `ws-billing-notice:${entityId}`);
      const [sent] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce_audit WHERE action = ${action}
        AND entity_id = ${entityId}::uuid AND details->>${key} = ${since.toISOString()}
        AND (${extra.stage ?? null}::text IS NULL OR details->>'stage' = ${extra.stage ?? null})`;
      if (sent) return;
      await audit(tx, action, entityId, undefined, { [key]: since.toISOString(), ...extra });
      await notifyCommerce(tx, userId, entityId, title, message, '/workspace/billing');
    });
  }
}

function vnDate(d: Date) {
  return d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
}
