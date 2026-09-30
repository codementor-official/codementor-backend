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
}
export interface PaymentInput {
  id: string;
  orderId: string;
  amount: number;
  createdAt: Date;
  expiresAt: Date;
}
