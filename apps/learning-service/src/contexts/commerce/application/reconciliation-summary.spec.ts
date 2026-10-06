import { WalletService, MockPayoutAdapter } from './wallet.service';
import type { CommerceStore } from '../infrastructure/commerce.store';
import type { PaymentProviders } from '../infrastructure/payment-providers';
jest.mock('../infrastructure/commerce.store', () => ({ CommerceStore: class {} }));
jest.mock('../infrastructure/payment-providers', () => ({ PaymentProviders: class {} }));

describe('Reconciliation summary schema compatibility', () => {
  it.each([false, true])('keeps diagnostic availability explicit (table ready: %s)', async (ready) => {
    const query = jest.fn().mockResolvedValueOnce([{ ready }]).mockResolvedValueOnce([{ gatewayIssues: ready ? 3n : null, liability: 100n, platform: 20n }]);
    const service = new WalletService({ db: { $queryRaw: query } } as unknown as CommerceStore, {} as PaymentProviders, new MockPayoutAdapter());
    const result = await service.reconciliation();
    expect(result.gatewayIssues).toBe(ready ? 3 : null);
    expect(result.liability).toBe(100);
    const diagnostic = query.mock.calls[1][1];
    expect(diagnostic.strings.join('').includes('commerce_reconciliation_issues')).toBe(ready);
  });
});
