import { CommerceJobs } from './commerce.jobs';
import { CommerceStore } from '../infrastructure/commerce.store';
import { OrdersService } from './orders.service';
import { WalletService } from './wallet.service';
jest.mock('../infrastructure/commerce.store', () => ({ CommerceStore: class {} }));

function setup() {
  const query = jest.fn(async () => []);
  const execute = jest.fn(async () => 0);
  const orders = { reconcile: jest.fn(async (_id: string): Promise<void> => undefined) };
  const wallet = {
    reconcileRefund: jest.fn(async () => undefined),
    releaseIncome: jest.fn(async (): Promise<{ availableAmount: number; debtOffset: number } | undefined> => undefined),
    processPayout: jest.fn(async () => undefined),
  };
  const jobs = new CommerceJobs(
    { db: { $queryRaw: query, $executeRaw: execute } } as unknown as CommerceStore,
    orders as unknown as OrdersService, wallet as unknown as WalletService,
  );
  return { query, execute, orders, wallet, jobs };
}
const remaining = [{ holding: 2n, refundBlocked: 1n, unverified: 3n, eligible: 0n }];

describe('CommerceJobs run reports (isolated mocks, no database writes)', () => {
  it('reports an empty batch, not fabricated confirmations or balances', async () => {
    const { jobs } = setup();
    const r = await jobs.tick();
    expect(r.status).toBe('completed');
    expect(r.stages).toHaveLength(5);
    expect(r.stages.every((s) => s.selected === 0)).toBe(true);
    expect(r.releasedAmountVnd).toBe(0);
    expect(r.remaining).toBeNull();
    expect(r.finishedAt >= r.startedAt).toBe(true);
  });
  it('does not count an unanswered provider query as verified', async () => {
    const { query, jobs } = setup();
    query.mockResolvedValueOnce([{ id: 'p1' }] as never)
      .mockResolvedValueOnce([{ status: 'pending', reconciled_at: null }] as never);
    const r = await jobs.tick();
    expect(r.stages[0]).toMatchObject({ selected: 1, completed: 0, waiting: 1, failed: 0 });
  });
  it('distinguishes a confirmed decline from an operational error', async () => {
    const { query, orders, jobs } = setup();
    query.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as never)
      .mockResolvedValueOnce([{ status: 'failed', reconciled_at: new Date() }] as never);
    orders.reconcile.mockImplementation(async (id) => { if (id === 'p2') throw new Error('secret provider detail'); });
    const r = await jobs.tick();
    expect(r.status).toBe('partial');
    expect(r.stages[0]).toMatchObject({ selected: 2, completed: 1, waiting: 0, failed: 1 });
    expect(r.stages[0].items[0].status).toBe('failed');
    expect(JSON.stringify(r)).not.toContain('secret provider detail');
    expect(r.stages).toHaveLength(5);
  });
  it('keeps a quarantined order waiting even if the gateway reports success', async () => {
    const { query, jobs } = setup();
    query.mockResolvedValueOnce([{ id: 'p1' }] as never)
      .mockResolvedValueOnce([{ status: 'paid', reconciled_at: new Date(), order_status: 'review' }] as never);
    const r = await jobs.tick();
    expect(r.stages[0]).toMatchObject({ completed: 0, waiting: 1 });
    expect(r.stages[0].items[0].status).toBe('review');
  });
  it('counts actual releases and debt offsets; blocked income is still waiting', async () => {
    const { query, execute, wallet, jobs } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'i1' }, { id: 'i2' }] as never)
      .mockResolvedValueOnce([]).mockResolvedValueOnce(remaining as never);
    wallet.releaseIncome.mockResolvedValueOnce({ availableAmount: 60000, debtOffset: 20000 });
    execute.mockResolvedValueOnce(4);
    const r = await jobs.tick();
    expect(r.stages[2]).toMatchObject({ selected: 4, completed: 4 });
    expect(r.stages[3]).toMatchObject({ selected: 2, completed: 1, waiting: 1 });
    expect(r.releasedAmountVnd).toBe(60000);
    expect(r.debtOffsetVnd).toBe(20000);
    expect(r.remaining).toEqual({ holding: 2, refundBlocked: 1, unverified: 3, eligible: 0 });
  });
  it('continues after selection failures and releases its busy lock', async () => {
    const { query, jobs } = setup();
    query.mockRejectedValueOnce(new Error('database credentials must not leak'));
    const r = await jobs.tick();
    expect(r.status).toBe('partial');
    expect(r.stages[0].error).toBeDefined();
    expect(r.stages).toHaveLength(5);
    expect(JSON.stringify(r)).not.toContain('database credentials');
    expect((await jobs.tick()).status).toBe('completed');
  });
  it('does not start a second overlapping run', async () => {
    const { query, jobs } = setup();
    let release!: (value: never[]) => void;
    query.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = jobs.tick();
    const second = await jobs.tick();
    expect(second.status).toBe('already_running');
    expect(second.processed).toBe(false);
    expect(second.stages).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    release([]);
    await first;
    expect((await jobs.tick()).processed).toBe(true);
  });
  it('preserves uncertainty when reading backlog counts fails', async () => {
    const { query, jobs } = setup();
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('unavailable'));
    expect((await jobs.tick()).remaining).toBeNull();
  });
  it('reports pending payouts and terminal refunds separately', async () => {
    const { query, jobs } = setup();
    query.mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'r1' }] as never)
      .mockResolvedValueOnce([{ status: 'succeeded' }] as never)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'w1' }] as never)
      .mockResolvedValueOnce([{ status: 'unknown' }] as never)
      .mockResolvedValueOnce(remaining as never);
    const r = await jobs.tick();
    expect(r.stages[1]).toMatchObject({ completed: 1, waiting: 0 });
    expect(r.stages[4]).toMatchObject({ completed: 0, waiting: 1 });
    expect(r.releasedAmountVnd).toBe(0);
  });
});
