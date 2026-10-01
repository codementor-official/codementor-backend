import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CommerceStore } from '../infrastructure/commerce.store';
import { OrdersService } from './orders.service';
import { WalletService } from './wallet.service';
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
    if (
      process.env.COMMERCE_JOBS_ENABLED === 'false' ||
      (process.env.NODE_ENV === 'production' && process.env.COMMERCE_JOBS_ENABLED !== 'true')
    ) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn('Commerce job failed; inspect database/provider availability'),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Reconciliation is bounded. Pending/unknown requests keep the original provider reference.
      const pending = await this.store.db.$queryRaw<
        { id: string }[]
      >`SELECT o.id FROM commerce_orders o JOIN commerce_payments p ON p.order_id=o.id
        WHERE o.status IN ('pending','expired','paid') AND p.provider<>'mock' AND (p.reconciled_at IS NULL OR p.status='pending')
        AND o.created_at>now()-interval '7 days' ORDER BY o.created_at LIMIT 20`;
      for (const p of pending) {
        try {
          await this.orders.reconcile(p.id);
        } catch {
          this.logger.warn(`Payment reconciliation pending: ${p.id}`);
        }
      }
      const refunds = await this.store.db.$queryRaw<
        { id: string }[]
      >`SELECT r.id FROM commerce_refunds r JOIN commerce_payments p ON p.order_id=r.order_id WHERE r.status IN ('pending','unknown') AND p.provider<>'mock' ORDER BY r.created_at LIMIT 20`;
      for (const r of refunds) {
        try {
          await this.wallet.reconcileRefund(r.id);
        } catch {
          this.logger.warn(`Refund reconciliation pending: ${r.id}`);
        }
      }
      await this.store.db
        .$executeRaw`UPDATE commerce_orders SET status='expired' WHERE status='pending' AND expires_at<=now()`;
      const releases = await this.store.db.$queryRaw<
        { id: string }[]
      >`SELECT id FROM commerce_orders WHERE status='paid' AND income_state='pending' AND available_at<=now() ORDER BY available_at LIMIT 50`;
      for (const row of releases) await this.wallet.releaseIncome(row.id);
      const withdrawals = await this.store.db.$queryRaw<
        { id: string }[]
      >`SELECT id FROM commerce_withdrawals WHERE status='approved' ORDER BY created_at LIMIT 50`;
      for (const row of withdrawals) await this.wallet.processPayout(row.id);
    } finally {
      this.busy = false;
    }
  }
}
