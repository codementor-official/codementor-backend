import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CommerceStore } from '../infrastructure/commerce.store';
import { OrdersService } from './orders.service';
import { WalletService } from './wallet.service';
import { CommerceJobName, CommerceJobRun, CommerceJobStage, CommerceJobOrderReport } from './commerce-job-result';
import { inspectJobOrders } from './commerce-job-orders';

@Injectable()
export class CommerceJobs implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly logger = new Logger(CommerceJobs.name);
  constructor(
    private readonly store: CommerceStore,
    private readonly orders: OrdersService,
    private readonly wallet: WalletService,
  ) {}
  onModuleInit() {
    if (process.env.COMMERCE_JOBS_ENABLED === 'false' ||
      (process.env.NODE_ENV === 'production' && process.env.COMMERCE_JOBS_ENABLED !== 'true')) return;
    this.timer = setInterval(() => {
      void this.tick().then((result) => {
        if (result.status === 'partial') this.logger.warn(`Commerce job partially completed: ${result.runId}`);
      }).catch(() => this.logger.warn('Commerce job failed; inspect database/provider availability'));
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // This GET-facing diagnostic never starts jobs, queries a gateway, or changes a balance.
  inspectOrders(page = 1): Promise<CommerceJobOrderReport> {
    return inspectJobOrders(this.store, page);
  }

  async tick(): Promise<CommerceJobRun> {
    const startedAt = new Date().toISOString();
    const report: CommerceJobRun = {
      runId: randomUUID(), startedAt, finishedAt: startedAt,
      status: this.busy ? 'already_running' : 'completed', processed: !this.busy,
      stages: [], releasedAmountVnd: 0, debtOffsetVnd: 0, remaining: null, orderReport: null,
    };
    if (this.busy) return report;
    this.busy = true;
    const releases = new Map<string, { availableAmount: number; debtOffset: number }>();
    // Preserve partial results: failures must not conceal completed work.
    const stage = async (name: CommerceJobName, execute: (s: CommerceJobStage) => Promise<void>) => {
      const s: CommerceJobStage = { name, selected: 0, completed: 0, waiting: 0, failed: 0, items: [] };
      report.stages.push(s);
      try { await execute(s); } catch {
        s.error = 'Không thể hoàn tất bước này. Kiểm tra nhật ký máy chủ trước khi chạy lại.';
        this.logger.warn(`Commerce job stage failed: ${name}; run=${report.runId}`);
      }
    };
    const records = async (s: CommerceJobStage, rows: { id: string }[], execute: (id: string) => Promise<{ complete: boolean; status?: string }>) => {
      s.selected = rows.length;
      for (const row of rows) {
        try {
          const result = await execute(row.id);
          const outcome = result.complete ? 'completed' : 'waiting';
          s[outcome]++;
          s.items.push({ id: row.id, outcome, status: result.status });
        } catch {
          s.failed++;
          s.items.push({ id: row.id, outcome: 'failed' });
          this.logger.warn(`Commerce job record requires review: ${s.name}; id=${row.id}; run=${report.runId}`);
        }
      }
    };
    try {
      await stage('payments', async (s) => {
        // Seven days here is the reconciliation LOOKBACK, not the order's holding period.
        const rows = await this.store.db.$queryRaw<{ id: string }[]>`
          SELECT o.id FROM commerce_orders o JOIN commerce_payments p ON p.order_id=o.id
          LEFT JOIN commerce_provider_query_leases ql ON ql.payment_id=p.id
          WHERE o.status IN ('pending','expired','paid','review','failed','cancelled') AND p.provider<>'mock'
          AND p.create_started_at IS NOT NULL AND (p.reconciled_at IS NULL OR p.status='pending')
          AND (p.provider<>'vnpay' OR ql.next_query_at IS NULL OR ql.next_query_at<=now())
          AND (o.created_at>now()-interval '7 days' OR o.income_state='pending') ORDER BY o.created_at LIMIT 20`;
        await records(s, rows, async (id) => {
          await this.orders.reconcile(id);
          const [p] = await this.store.db.$queryRaw<{ status: string; reconciled_at: Date | null; order_status: string }[]>`
            SELECT p.status,p.reconciled_at,o.status AS order_status FROM commerce_payments p
            JOIN commerce_orders o ON o.id=p.order_id WHERE p.order_id=${id}::uuid`;
          return { complete: !!p?.reconciled_at && p.order_status !== 'review' &&
            !['pending','review','unknown'].includes(p.status), status: p?.order_status === 'review' ? 'review' : p?.status };
        });
      });
      await stage('refunds', async (s) => {
        const rows = await this.store.db.$queryRaw<{ id: string }[]>`
          SELECT r.id FROM commerce_refunds r JOIN commerce_payments p ON p.order_id=r.order_id
          WHERE r.status IN ('pending','unknown') AND p.provider<>'mock' ORDER BY r.created_at LIMIT 20`;
        await records(s, rows, async (id) => {
          await this.wallet.reconcileRefund(id);
          const [r] = await this.store.db.$queryRaw<{ status: string }[]>`SELECT status FROM commerce_refunds WHERE id=${id}::uuid`;
          return { complete: !!r && ['succeeded','failed'].includes(r.status), status: r?.status };
        });
      });
      await stage('expiry', async (s) => {
        s.completed = await this.store.db.$executeRaw`UPDATE commerce_orders SET status='expired' WHERE status='pending' AND expires_at<=now()`;
        s.selected = s.completed;
      });
      await stage('income', async (s) => {
        const rows = await this.store.db.$queryRaw<{ id: string }[]>`
          SELECT id FROM commerce_orders WHERE status='paid' AND income_state='pending' AND available_at<=now() ORDER BY available_at LIMIT 50`;
        await records(s, rows, async (id) => {
          const release = await this.wallet.releaseIncome(id);
          if (release) {
            releases.set(id, release);
            report.releasedAmountVnd += release.availableAmount;
            report.debtOffsetVnd += release.debtOffset;
          }
          return { complete: !!release, status: release ? 'available' : 'pending' };
        });
      });
      await stage('payouts', async (s) => {
        const rows = await this.store.db.$queryRaw<{ id: string }[]>`
          SELECT id FROM commerce_withdrawals WHERE status='approved' ORDER BY created_at LIMIT 50`;
        await records(s, rows, async (id) => {
          await this.wallet.processPayout(id);
          const [w] = await this.store.db.$queryRaw<{ status: string }[]>`SELECT status FROM commerce_withdrawals WHERE id=${id}::uuid`;
          return { complete: !!w && ['succeeded','failed'].includes(w.status), status: w?.status };
        });
      });
      try {
        const [remaining] = await this.store.db.$queryRaw<{
          holding: bigint; refundBlocked: bigint; unverified: bigint; eligible: bigint;
        }[]>`WITH waiting AS (
          SELECT CASE
            WHEN EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.order_id=o.id AND r.status IN ('pending','unknown','succeeded')) THEN 'refund'
            WHEN p.reconciled_at IS NULL THEN 'unverified'
            WHEN o.available_at IS NULL OR o.available_at>now() THEN 'holding'
            ELSE 'eligible' END AS reason
          FROM commerce_orders o JOIN commerce_payments p ON p.order_id=o.id
          WHERE o.status='paid' AND o.income_state='pending'
        ) SELECT count(*) FILTER(WHERE reason='holding') AS holding,
          count(*) FILTER(WHERE reason='refund') AS "refundBlocked",
          count(*) FILTER(WHERE reason='unverified') AS unverified,
          count(*) FILTER(WHERE reason='eligible') AS eligible FROM waiting`;
        if (remaining) report.remaining = {
          holding: Number(remaining.holding), refundBlocked: Number(remaining.refundBlocked),
          unverified: Number(remaining.unverified), eligible: Number(remaining.eligible),
        };
      } catch { this.logger.warn(`Commerce job remaining counts unavailable: ${report.runId}`); }
      try {
        const ids = report.stages.filter(s => ['payments', 'income'].includes(s.name))
          .flatMap(s => s.items.map(item => item.id));
        const errors = new Set(report.stages.filter(s => ['payments', 'income'].includes(s.name))
          .flatMap(s => s.items.filter(item => item.outcome === 'failed').map(item => item.id)));
        // Bounded snapshot: touched orders first, then other held orders. No additional financial work.
        report.orderReport = await inspectJobOrders(this.store, 1, [...new Set(ids)], releases, errors, 100);
      } catch { this.logger.warn(`Commerce job order diagnostics unavailable: ${report.runId}`); }
      report.status = report.stages.some((s) => s.failed > 0 || s.error) ? 'partial' : 'completed';
      return report;
    } finally {
      report.finishedAt = new Date().toISOString();
      this.busy = false;
    }
  }
}
