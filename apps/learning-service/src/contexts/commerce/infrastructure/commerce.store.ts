import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@codementor/platform';
export type Tx = Prisma.TransactionClient;
export interface OrderRow {
  id: string;
  buyer_id: string;
  instructor_id: string;
  course_id: string;
  course_title: string;
  course_cover_image_url?: string | null;
  amount: number;
  instructor_amount: number;
  platform_amount: number;
  instructor_bps: number;
  status: string;
  income_state: string;
  mode: 'mock' | 'sandbox';
  hold_days: number;
  hold_minutes?: number | null;
  expires_at: Date;
  created_at: Date;
  available_at: Date | null;
  settled_at: Date | null;
  fee_amount: number | null;
  fee_source: string;
  buyer_name?: string;
  buyer_email?: string;
  pricing_snapshot?: unknown;
}
export interface PaymentRow {
  id: string;
  order_id: string;
  provider: 'mock' | 'vnpay' | 'momo';
  status: string;
  provider_ref: string | null;
  checkout_url: string | null;
  created_at: Date;
}
export interface PolicyRow {
  instructor_bps: number;
  hold_days: number;
  hold_minutes?: number | null;
  minimum_withdrawal: number;
  approval_required: boolean;
}
export interface WithdrawalRow {
  id: string;
  instructor_id: string;
  amount: number;
  status: string;
  scenario: 'success' | 'failure' | 'pending' | 'timeout';
  recipient_snapshot: unknown;
  created_at: Date;
  reason: string | null;
}
export interface RefundRow {
  id: string;
  order_id: string;
  amount: number;
  status: string;
  held_amount: number;
  debt_amount: number;
  from_account: 'pending' | 'available';
  reason: string;
}
export async function lock(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
export async function balance(tx: Tx, owner: string, account: string): Promise<number> {
  const [row] = await tx.$queryRaw<
    { amount: bigint }[]
  >`SELECT COALESCE(sum(amount),0)::bigint AS amount
    FROM commerce_entries WHERE owner_id=${owner}::uuid AND account=${account}`;
  const value = Number(row.amount);
  if (!Number.isSafeInteger(value)) throw new Error('Balance exceeds safe integer range');
  return value;
}
export async function journal(
  tx: Tx,
  event: string,
  entries: { owner?: string; account: string; amount: number }[],
  links: { order?: string; withdrawal?: string; refund?: string } = {},
) {
  const nonzero = entries.filter((e) => e.amount !== 0);
  if (!nonzero.length) return;
  if (nonzero.reduce((sum, e) => sum + BigInt(e.amount), 0n) !== 0n)
    throw new Error('Unbalanced journal');
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`INSERT INTO commerce_journals(event_key,order_id,withdrawal_id,refund_id)
    VALUES (${event},${links.order ?? null}::uuid,${links.withdrawal ?? null}::uuid,${links.refund ?? null}::uuid)
    ON CONFLICT(event_key) DO NOTHING RETURNING id`;
  if (!rows[0]) return;
  for (const e of nonzero)
    await tx.$executeRaw`INSERT INTO commerce_entries(journal_id,owner_id,account,amount)
    VALUES (${rows[0].id}::uuid,${e.owner ?? null}::uuid,${e.account},${BigInt(e.amount)})`;
}
export async function audit(
  tx: Tx,
  action: string,
  entity: string | null,
  actor?: string,
  details: unknown = {},
) {
  await tx.$executeRaw`INSERT INTO commerce_audit(actor_id,action,entity_id,details)
    VALUES (${actor ?? null}::uuid,${action},${entity}::uuid,${JSON.stringify(details)}::jsonb)`;
}
@Injectable()
export class CommerceStore {
  constructor(readonly db: PrismaService) {}
  async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, { timeout: 15000, maxWait: 15000 });
      } catch (error) {
        if (
          attempt >= 2 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034'
        )
          throw error;
      }
    }
  }
}
export function orderView(o: OrderRow) {
  return {
    id: o.id,
    courseId: o.course_id,
    courseTitle: o.course_title,
    courseCoverImageUrl: o.course_cover_image_url ?? null,
    amount: o.amount,
    currency: 'VND',
    instructorAmount: o.instructor_amount,
    platformAmount: o.platform_amount,
    instructorBps: o.instructor_bps,
    status: o.status,
    incomeState: o.income_state,
    mode: o.mode,
    expiresAt: o.expires_at,
    createdAt: o.created_at,
    availableAt: o.available_at,
    holdMinutes: o.hold_minutes ?? o.hold_days * 1440,
    settledAt: o.settled_at,
    feeAmount: o.fee_amount,
    feeSource: o.fee_source,
    buyer: o.buyer_name ? { name: o.buyer_name, email: o.buyer_email ?? '' } : null,
    pricingSnapshot: o.pricing_snapshot ?? null,
  };
}
