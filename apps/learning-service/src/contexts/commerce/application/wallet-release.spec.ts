import { WalletService, MockPayoutAdapter } from './wallet.service';
import { CommerceStore } from '../infrastructure/commerce.store';
import { PaymentProviders } from '../infrastructure/payment-providers';
jest.mock('@codementor/platform', () => ({ PrismaService: class {} }));

function setup(ready: boolean) {
  const order = { id: 'order', instructor_id: 'lecturer', instructor_amount: 80000 };
  const query = jest.fn()
    .mockResolvedValueOnce([]) // advisory lock
    .mockResolvedValueOnce(ready ? [order] : []) // locked eligibility recheck
    .mockResolvedValueOnce([{ amount: -20000n }]) // debt
    .mockResolvedValueOnce([{ id: 'journal' }]); // inserted journal
  const execute = jest.fn().mockResolvedValue(1);
  const transaction = jest.fn(async (work) => work({ $queryRaw: query, $executeRaw: execute }));
  const store = { db: { $queryRaw: jest.fn().mockResolvedValue([order]) }, transaction };
  const service = new WalletService(store as unknown as CommerceStore,
    { assertEnabled: jest.fn() } as unknown as PaymentProviders, new MockPayoutAdapter());
  return { service, store, query, execute };
}
describe('Income release reporting preserves financial eligibility', () => {
  it('returns actual available credit and debt offset only after the transaction succeeds', async () => {
    const { service, execute } = setup(true);
    await expect(service.releaseIncome('order')).resolves.toEqual({ availableAmount: 60000, debtOffset: 20000 });
    expect(execute).toHaveBeenCalledTimes(5); // three entries, state update, audit
  });
  it('returns no release for an ineligible/already released order, without ledger writes', async () => {
    const { service, query, execute } = setup(false);
    await expect(service.releaseIncome('order')).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    const sql = query.mock.calls[1][0].join('');
    expect(sql).toContain("income_state='pending'");
    expect(sql).toContain('available_at<=now()');
    expect(sql).toContain('p.reconciled_at IS NOT NULL');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('FOR UPDATE');
  });
  it('does not report a credit if the transaction rolls back', async () => {
    const { service, store } = setup(true);
    store.transaction.mockRejectedValueOnce(new Error('rollback'));
    await expect(service.releaseIncome('order')).rejects.toThrow('rollback');
  });
});
