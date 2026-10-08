import { orderView } from '../infrastructure/commerce.store';
import type { OrderRow } from '../infrastructure/commerce.store';
import { WalletService, MockPayoutAdapter } from './wallet.service';
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
      .mockResolvedValueOnce([{ next_at: new Date('2026-10-08T12:01:00Z'), awaiting_release: 1n, unverified: 2n, refund_blocked: 0n }]);
    const store = { db: { $queryRaw: query } };
    const wallet = new WalletService(store as never, { mode: 'sandbox' } as never, new MockPayoutAdapter());
    const summary = await wallet.summary('lecturer');
    expect(summary.policy.holdMinutes).toBe(1);
    expect(summary.balances.pending).toBe(80000);
    expect(summary.holding.awaitingRelease).toBe(1);
    expect(summary.holding.unverified).toBe(2);
    expect(query.mock.calls[3][0].join('')).toContain('o.instructor_id=');
    expect(query.mock.calls[3][0].join('')).toContain('p.reconciled_at IS NOT NULL');
  });
});
