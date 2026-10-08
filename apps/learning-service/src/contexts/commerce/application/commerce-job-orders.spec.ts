import { inspectJobOrders, jobOrderView, JobOrderRow } from './commerce-job-orders';
import { CommerceStore } from '../infrastructure/commerce.store';
jest.mock('../infrastructure/commerce.store', () => ({ CommerceStore: class {} }));

const row: JobOrderRow = {
  id: 'order', course_title: 'Go cơ bản', instructor_name: 'Giảng viên A', buyer_name: 'Học viên B',
  amount: 100000, instructor_amount: 80000, status: 'paid', income_state: 'pending',
  available_at: new Date('2026-10-08T04:51:00Z'), reconciled_at: null,
  next_query_at: new Date('2026-10-08T04:56:00Z'), refund_blocked: false,
  hold_expired: true, query_deferred: true,
};
describe('Per-order job diagnostics, read-only', () => {
  it('explains why a one-minute expired hold is still awaiting verification', () => {
    expect(jobOrderView(row)).toMatchObject({ reason: 'verification', verificationDeferred: true,
      holdUntil: '2026-10-08T04:51:00.000Z', nextVerificationAt: '2026-10-08T04:56:00.000Z', releasedAmountVnd: 0 });
  });
  it('does not fabricate a release from an available snapshot', () => {
    expect(jobOrderView({ ...row, income_state: 'available' })).toMatchObject({ reason: 'available', releasedAmountVnd: 0 });
  });
  it('reports only committed credits and distinguishes a full debt offset', () => {
    expect(jobOrderView(row, { availableAmount: 0, debtOffset: 80000 })).toMatchObject({
      reason: 'released', releasedAmountVnd: 0, debtOffsetVnd: 80000,
    });
  });
  it('refunds take precedence over verification and expired holds', () => {
    expect(jobOrderView({ ...row, refund_blocked: true }).reason).toBe('refund');
  });
  it('verified orders still respect their hold and distinguish the eligible queue', () => {
    const verified = { ...row, reconciled_at: new Date() };
    expect(jobOrderView({ ...verified, hold_expired: false }).reason).toBe('holding');
    expect(jobOrderView(verified).reason).toBe('eligible');
    expect(jobOrderView({ ...verified, hold_expired: null }).reason).toBe('holding');
  });
  it('does not mistake quarantined or unpaid orders for withdrawable money', () => {
    expect(jobOrderView({ ...row, status: 'review' }).reason).toBe('review');
    expect(jobOrderView({ ...row, status: 'failed' }).reason).toBe('not_paid');
    expect(jobOrderView(row, undefined, true).encounteredError).toBe(true);
  });
  it('queries a bounded stable page and never performs a write or provider call', async () => {
    const query = jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([{ total: 45n }]);
    const execute = jest.fn();
    const report = await inspectJobOrders({ db: { $queryRaw: query, $executeRaw: execute } } as unknown as CommerceStore, 2);
    expect(report).toMatchObject({ page: 2, limit: 20, total: 45, items: [{ courseTitle: 'Go cơ bản' }] });
    expect(query.mock.calls[0]).toContain(20);
    expect(query.mock.calls[0][0].join('')).toContain('LIMIT ');
    expect(query.mock.calls[0][0].join('')).toContain('o.id');
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not leak query failures as an empty report', async () => {
    const query = jest.fn().mockRejectedValue(new Error('unavailable'));
    await expect(inspectJobOrders({ db: { $queryRaw: query } } as unknown as CommerceStore)).rejects.toThrow('unavailable');
  });
});
