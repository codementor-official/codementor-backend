import { HttpException, HttpStatus } from '@nestjs/common';
import type { CommerceStore } from './commerce.store';

// One durable lease shared by every instance, manual refresh and background jobs.
// Keep the lease after errors/timeouts: the provider may already have received the request.
export async function acquireVnpayQueryLease(db: CommerceStore['db'], paymentId: string) {
  const claimed = await db.$queryRaw<{ payment_id: string }[]>`
    INSERT INTO commerce_provider_query_leases(payment_id,next_query_at)
    VALUES (${paymentId}::uuid,now()+interval '6 minutes')
    ON CONFLICT(payment_id) DO UPDATE
      SET next_query_at=now()+interval '6 minutes'
      WHERE commerce_provider_query_leases.next_query_at<=now()
    RETURNING payment_id`;
  if (claimed.length) return;
  const [row] = await db.$queryRaw<{ seconds: number }[]>`
    SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM next_query_at-now())))::int AS seconds
    FROM commerce_provider_query_leases WHERE payment_id=${paymentId}::uuid`;
  throw new HttpException({
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
    message: 'VNPAY đang trong thời gian chờ tra soát. Vui lòng thử lại sau.',
    code: 'VNPAY_QUERY_COOLDOWN',
    retryAfterSeconds: row?.seconds ?? 360,
  }, HttpStatus.TOO_MANY_REQUESTS);
}
