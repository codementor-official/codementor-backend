import { RevenueAnalyticsService, revenueReport } from './revenue-analytics.service';
import type { CommerceStore } from '../infrastructure/commerce.store';
jest.mock('../infrastructure/commerce.store', () => ({ CommerceStore: class {} }));

describe('Revenue reporting', () => {
  const base = { date: '2026-10-06', courseId: 'c', courseTitle: 'Course', orders: 1n, gross: 100n, share: 80n };
  it('passes the identical parameterized calendar bounds to reports and instructor sales, without filtering current balances', async () => {
    const range = { from: '2026-10-01', to: '2026-10-06' };
    const reportQuery = jest.fn().mockResolvedValueOnce([{ date: range.from }, { date: range.to }]).mockResolvedValueOnce([]);
    const directoryQuery = jest.fn().mockResolvedValue([]);
    const store = { transaction: (work: (tx: unknown) => unknown) => work({ $queryRaw: reportQuery }), db: { $queryRaw: directoryQuery } } as unknown as CommerceStore;
    const service = new RevenueAnalyticsService(store);
    const result = await service.report(30, undefined, 'admin', range);
    await service.instructors(30, range);
    expect(result).toMatchObject({ from: range.from, to: range.to });
    for (const args of [reportQuery.mock.calls[0], directoryQuery.mock.calls[0]]) {
      const values = args.slice(1).flatMap((part: { values?: unknown[] }) => part.values ?? []);
      expect(values).toEqual([range.from, range.to]);
    }
    const sql = directoryQuery.mock.calls[0][0].join('');
    expect(sql.split('balances AS')[1].split(') SELECT')[0]).not.toContain('WHERE created_at');
  });
  it('rejects malformed ranges for both endpoints before touching the database', async () => {
    const service = new RevenueAnalyticsService({} as CommerceStore);
    await expect(service.report(30, undefined, 'admin', { from: '2026-10-01' })).rejects.toThrow('đầy đủ');
    await expect(service.instructors(30, { from: '2026-10-02', to: '2026-10-01' })).rejects.toThrow('kết thúc');
  });
  it('excludes unpaid amounts and subtracts fully refunded cohorts, preserving historical split', () => {
    const report = revenueReport([{ ...base, status: 'paid' }, { ...base, status: 'refunded' }, { ...base, status: 'pending' }], ['2026-10-05', base.date], 'lecturer');
    expect(report.totals).toEqual({ gross: 200, revenue: 80, refunded: 100, paidOrders: 2 });
    expect(report.daily[0].revenue).toBe(0);
    expect(report.courses[0].revenue).toBe(80);
    expect(report.statuses.pending).toBe(1);
  });
  it('returns zero days and no invented courses for an empty period', () => {
    expect(revenueReport([], ['2026-10-06'], 'admin').courses).toEqual([]);
  });
  it('does not round unsafe currency totals', () => {
    expect(() => revenueReport([{ ...base, gross: 9007199254740992n, status: 'paid' }], [base.date], 'admin')).toThrow('safe integer');
  });
  it('rejects unbounded periods before accessing the database', async () => {
    const service = new RevenueAnalyticsService({} as CommerceStore);
    await expect(service.report(365)).rejects.toThrow('7, 30');
  });
  it('does not silently truncate reports to ten courses', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...base, courseId: `course-${i}`, status: 'paid' }));
    expect(revenueReport(rows, [base.date], 'admin').courses).toHaveLength(12);
  });
  it('keeps platform-share semantics when an admin filters by instructor', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ date: base.date }]).mockResolvedValueOnce([]);
    const store = { transaction: (work: (tx: unknown) => unknown) => work({ $queryRaw: query }) } as unknown as CommerceStore;
    const report = await new RevenueAnalyticsService(store).report(30, 'instructor-id', 'admin');
    expect(report.scope).toBe('admin');
    expect(query.mock.calls[1].some((part: unknown) => typeof part === 'object' && part !== null && 'strings' in part && (part as { strings: string[] }).strings.join('').includes('platform_amount'))).toBe(true);
  });
  it('validates instructor directory periods and maps read-only balances without rounding', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'i', name: 'Instructor', email: 'i@test.local', orders: 1n, gross: 100n, revenue: 80n, platformRevenue: 20n, pending: 80n, available: 0n, reserved: 0n, paid: 0n }]);
    const service = new RevenueAnalyticsService({ db: { $queryRaw: query } } as unknown as CommerceStore);
    await expect(service.instructors(365)).rejects.toThrow('7, 30');
    expect(query).not.toHaveBeenCalled();
    expect((await service.instructors(7))[0]).toMatchObject({ revenue: 80, platformRevenue: 20, available: 0 });
  });
  it('scopes lecturer queries to the authenticated instructor without joining duplicate payment rows', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ date: base.date }]).mockResolvedValueOnce([]);
    const store = { transaction: (work: (tx: unknown) => unknown) => work({ $queryRaw: query }) } as unknown as CommerceStore;
    const report = await new RevenueAnalyticsService(store).report(7, 'lecturer-id');
    const args = query.mock.calls[1];
    const scope = args.at(-1);
    expect(scope.values).toContain('lecturer-id');
    expect(scope.strings.join('')).toContain('instructor_id=');
    expect(args[0].join('')).not.toContain('JOIN');
    expect(report.scope).toBe('lecturer');
  });
});
