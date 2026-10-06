/** VND integers. Floor instructor share, give the remainder to the platform. */
export function splitRevenue(amount: number, instructorBps: number) {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > 1_000_000_000 ||
    !Number.isInteger(instructorBps) ||
    instructorBps < 0 ||
    instructorBps > 10000
  ) {
    throw new Error('Invalid VND amount or revenue share');
  }
  const instructor = Number((BigInt(amount) * BigInt(instructorBps)) / 10000n);
  return { instructor, platform: amount - instructor };
}
export type PaymentProvider = 'mock' | 'vnpay' | 'momo';
export type ProviderResult = 'success' | 'failure' | 'cancelled' | 'pending' | 'unknown';
export type PayoutScenario = 'success' | 'failure' | 'pending' | 'timeout';
export interface PaymentEvidence {
  paymentId: string;
  amount: number;
  reference: string;
  result: ProviderResult;
  fingerprint: string;
  paidAt?: Date;
}
// A delayed IPN/query response is not a late payment. Only authenticated gateway
// time may recover an expired order; cancelled/failed orders still require review.
export function requiresPaymentReview(
  order: { created_at: Date; expires_at: Date; status: string },
  existingAccess: boolean,
  evidence: Pick<PaymentEvidence, 'paidAt'>,
  now = Date.now(),
) {
  if (existingAccess || !['pending', 'expired'].includes(order.status)) return true;
  const paidAt = evidence.paidAt?.getTime();
  if (paidAt !== undefined) return !Number.isFinite(paidAt)
    || paidAt < order.created_at.getTime() || paidAt > order.expires_at.getTime() || paidAt > now + 120000;
  return order.status !== 'pending' || order.expires_at.getTime() < now;
}
export interface PaymentInput {
  id: string;
  orderId: string;
  amount: number;
  createdAt: Date;
  expiresAt: Date;
}
