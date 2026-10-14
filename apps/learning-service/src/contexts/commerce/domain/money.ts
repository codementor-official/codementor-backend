/**
 * Giới hạn số tiền một giao dịch VNPAY: từ 5.000 ₫ đến dưới 1 tỷ ₫. Giá ngoài khoảng này vẫn
 * lưu được vào database (CHECK chỉ chặn 0–1 tỷ) nhưng học viên bấm mua thì cổng từ chối —
 * nên chặn ngay lúc đặt giá, ở cả giá niêm yết lẫn giá ưu đãi.
 */
export const MIN_PAID_PRICE_VND = 5_000;
export const MAX_PRICE_VND = 999_999_999;

/** Câu lỗi cho một giá niêm yết, hoặc `null` nếu hợp lệ. 0 = miễn phí. */
export function listPriceViolation(price: number): string | null {
  if (!Number.isSafeInteger(price) || price < 0) return 'Giá phải là số nguyên VND không âm.';
  if (price === 0) return null;
  if (price < MIN_PAID_PRICE_VND || price > MAX_PRICE_VND)
    return 'Giá khóa học trả phí phải từ 5.000 ₫ đến dưới 1 tỷ ₫ (giới hạn của cổng thanh toán). Đặt 0 để miễn phí.';
  return null;
}

/** Câu lỗi cho một giá ưu đãi so với giá gốc, hoặc `null` nếu hợp lệ. */
export function salePriceViolation(sale: number, base: number): string | null {
  if (base <= 0) return 'Khóa học miễn phí không cần tạo khuyến mãi.';
  if (!Number.isSafeInteger(sale) || sale < MIN_PAID_PRICE_VND)
    return 'Giá ưu đãi phải từ 5.000 ₫ (giới hạn của cổng thanh toán).';
  if (sale >= base) return 'Giá ưu đãi phải thấp hơn giá niêm yết.';
  return null;
}

/** Giá ưu đãi khi giảm theo %, làm tròn xuống bội số 1.000 ₫ như form của giảng viên. */
export function discountedPrice(base: number, discountPercent: number): number {
  return Math.floor((base * (100 - discountPercent)) / 100_000) * 1_000;
}

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
