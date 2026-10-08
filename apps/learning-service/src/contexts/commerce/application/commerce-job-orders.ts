import { CommerceStore } from '../infrastructure/commerce.store';
import { CommerceJobOrder, CommerceJobOrderReport } from './commerce-job-result';

export interface JobOrderRow {
  id: string; course_title: string; instructor_name: string | null; buyer_name: string | null;
  amount: number; instructor_amount: number; status: string; income_state: string;
  available_at: Date | null; reconciled_at: Date | null; next_query_at: Date | null;
  refund_blocked: boolean; hold_expired: boolean | null; query_deferred: boolean | null;
}
export function jobOrderView(
  row: JobOrderRow,
  release?: { availableAmount: number; debtOffset: number },
  encounteredError = false,
): CommerceJobOrder {
  const reason = release ? 'released'
    : row.status === 'review' ? 'review'
    : row.income_state === 'available' ? 'available'
    : row.status !== 'paid' ? 'not_paid'
    : row.refund_blocked ? 'refund'
    : !row.reconciled_at ? 'verification'
    : !row.hold_expired ? 'holding' : 'eligible';
  return {
    id: row.id, courseTitle: row.course_title,
    instructorName: row.instructor_name || 'Giảng viên', buyerName: row.buyer_name || 'Học viên',
    amountVnd: row.amount, instructorAmountVnd: row.instructor_amount,
    releasedAmountVnd: release?.availableAmount ?? 0, debtOffsetVnd: release?.debtOffset ?? 0,
    status: row.status, incomeState: row.income_state, reason,
    holdUntil: row.available_at?.toISOString() ?? null,
    verifiedAt: row.reconciled_at?.toISOString() ?? null,
    nextVerificationAt: row.next_query_at?.toISOString() ?? null,
    verificationDeferred: row.query_deferred === true, encounteredError,
  };
}

export async function inspectJobOrders(
  store: CommerceStore, page = 1, touchedIds: string[] = [],
  releases = new Map<string, { availableAmount: number; debtOffset: number }>(),
  errors = new Set<string>(), limit = 20,
): Promise<CommerceJobOrderReport> {
  const rows = await store.db.$queryRaw<JobOrderRow[]>`
    SELECT o.id,o.course_title,o.amount,o.instructor_amount,o.status,o.income_state,o.available_at,
      i.display_name AS instructor_name,b.display_name AS buyer_name,p.reconciled_at,q.next_query_at,
      o.available_at<=now() AS hold_expired,q.next_query_at>now() AS query_deferred,
      EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.order_id=o.id AND r.status IN ('pending','unknown','succeeded')) AS refund_blocked
    FROM commerce_orders o LEFT JOIN users i ON i.id=o.instructor_id LEFT JOIN users b ON b.id=o.buyer_id
      LEFT JOIN commerce_payments p ON p.order_id=o.id
      LEFT JOIN commerce_provider_query_leases q ON q.payment_id=p.id
    WHERE (o.status='paid' AND o.income_state='pending') OR o.id=ANY(${touchedIds}::uuid[])
    ORDER BY (o.id=ANY(${touchedIds}::uuid[])) DESC,o.available_at ASC NULLS LAST,o.id
    LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
  const [count] = await store.db.$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS total FROM commerce_orders o
    WHERE (o.status='paid' AND o.income_state='pending') OR o.id=ANY(${touchedIds}::uuid[])`;
  if (!count) throw new Error('Order diagnostic count unavailable');
  return {
    items: rows.map(row => jobOrderView(row, releases.get(row.id), errors.has(row.id))),
    total: Number(count.total), page, limit, capturedAt: new Date().toISOString(),
  };
}
