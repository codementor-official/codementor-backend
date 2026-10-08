import { orderView } from '../infrastructure/commerce.store';
import type { OrderRow } from '../infrastructure/commerce.store';
import { WalletService, MockPayoutAdapter } from './wallet.service';
import { OrdersService } from './orders.service';
jest.mock('@codementor/platform', () => ({ PrismaService: class {} }));

describe('Exact holding snapshots and lecturer explanations', () => {
  it('keeps old snapshots in days and never rounds a one-minute order up in its API', () => {
    expect(orderView({ hold_days: 7, hold_minutes: null } as OrderRow).holdMinutes).toBe(10080);
    expect(orderView({ hold_days: 1, hold_minutes: 1 } as OrderRow).holdMinutes).toBe(1);
    expect(orderView({ hold_days: 0, hold_minutes: 0 } as OrderRow).holdMinutes).toBe(0);
  });
  it('reports current policy separately from existing order deadlines, with no financial writes', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ account: 'pending', amount: 80000n }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ hold_days: 1, hold_minutes: 1, minimum_withdrawal: 100000, instructor_bps: 8000, approval_required: true }])
      .mockResolvedValueOnce([{ next_at: new Date('2026-10-08T12:01:00Z'), next_query_at: new Date('2026-10-08T12:06:00Z'), awaiting_release: 1n, unverified: 2n, refund_blocked: 0n }]);
    const store = { db: { $queryRaw: query } };
    const wallet = new WalletService(store as never, { mode: 'sandbox' } as never, new MockPayoutAdapter());
    const summary = await wallet.summary('lecturer');
    expect(summary.policy.holdMinutes).toBe(1);
    expect(summary.balances.pending).toBe(80000);
    expect(summary.holding.awaitingRelease).toBe(1);
    expect(summary.holding.unverified).toBe(2);
    expect(summary.holding.nextVerificationAt).toEqual(new Date('2026-10-08T12:06:00Z'));
    expect(query.mock.calls[3][0].join('')).toContain('o.instructor_id=');
    expect(query.mock.calls[3][0].join('')).toContain('p.reconciled_at IS NOT NULL');
    expect(query.mock.calls[3][0].join('')).toContain('q.next_query_at>now()');
  });
  it('does not present hold expiry as gateway verification, and exposes no provider payload', () => {
    const deadline = new Date('2026-10-08T04:51:03Z');
    const nextQuery = new Date('2026-10-08T04:56:59Z');
    const view = orderView({ income_state: 'pending', available_at: deadline, hold_minutes: 1,
      payment_reconciled_at: null, next_query_at: nextQuery, refund_blocked: false, hold_expired: true } as OrderRow);
    expect(view).toMatchObject({ incomeState: 'pending', holdMinutes: 1, paymentVerified: false, availableAt: deadline, nextVerificationAt: nextQuery, holdExpired: true });
    expect(view).not.toHaveProperty('provider_ref');
    expect(orderView({ payment_reconciled_at: new Date(), income_state: 'available' } as OrderRow))
      .toMatchObject({ paymentVerified: true, incomeState: 'available' });
    expect(orderView({} as OrderRow).paymentVerified).toBeUndefined();
  });
  it('keeps diagnostics scoped to the lecturer and paginates before returning order views', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'order', payment_reconciled_at: null, refund_blocked: true }])
      .mockResolvedValueOnce([{ total: 21n }]);
    const service = new OrdersService({ db: { $queryRaw: query } } as never, {} as never);
    const page = await service.list('lecturer', 2, 'instructor');
    expect(page).toMatchObject({ page: 2, limit: 20, total: 21 });
    expect(page.items[0]).toMatchObject({ paymentVerified: false, refundBlocked: true });
    const select = query.mock.calls[0][0];
    expect(select.sql).toContain('o.instructor_id=');
    expect(select.sql).toContain('LIMIT 20 OFFSET');
    expect(select.values).toContain('lecturer');
    expect(select.values).toContain(20);
  });
});
