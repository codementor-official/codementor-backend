import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notifyCommerce } from '../infrastructure/commerce-notification';
import { PaymentProviders } from '../infrastructure/payment-providers';
import {
  CommerceStore,
  lock,
  journal,
  audit,
  balance,
  OrderRow,
  PolicyRow,
  WithdrawalRow,
  RefundRow,
  PaymentRow,
} from '../infrastructure/commerce.store';
import type { PayoutScenario, ProviderResult } from '../domain/money';

/** No bank SDK: this adapter cannot send real funds. Stable reference is the withdrawal id. */
@Injectable()
export class MockPayoutAdapter {
  async send(id: string, scenario: PayoutScenario) {
    return {
      reference: `mock-payout-${id}`,
      result: scenario === 'timeout' ? 'unknown' : scenario,
    } as const;
  }
}
@Injectable()
export class WalletService {
  constructor(
    private readonly store: CommerceStore,
    private readonly providers: PaymentProviders,
    private readonly payout: MockPayoutAdapter,
  ) {}
  async summary(userId: string) {
    const rows = await this.store.db.$queryRaw<
      { account: string; amount: bigint }[]
    >`SELECT account,sum(amount)::bigint AS amount FROM commerce_entries WHERE owner_id=${userId}::uuid GROUP BY account`;
    const balances = Object.fromEntries(
      ['pending', 'available', 'reserved', 'paid', 'refund_held', 'debt'].map((k) => [
        k,
        Number(rows.find((r) => r.account === k)?.amount ?? 0),
      ]),
    );
    const [recipient] = await this.store.db.$queryRaw<
      { label: string; test_reference: string; method: string; institution_code: string; account_name: string; account_number: string }[]
    >`SELECT label,test_reference,method,institution_code,account_name,account_number FROM commerce_recipients WHERE user_id=${userId}::uuid`;
    const [policy] = await this.store.db.$queryRaw<PolicyRow[]>`SELECT * FROM commerce_policy`;
    return {
      balances,
      recipient: recipient
        ? {
            label: recipient.label,
            testReference: recipient.test_reference,
            method: recipient.method,
            institutionCode: recipient.institution_code,
            accountName: recipient.account_name,
            accountNumber: recipient.account_number,
          }
        : null,
      policy: {
        minimumWithdrawal: policy.minimum_withdrawal,
        holdDays: policy.hold_days,
        instructorBps: policy.instructor_bps,
        approvalRequired: policy.approval_required,
      },
      mode: this.providers.mode,
    };
  }
  async reconciliation() {
    const [result] = await this.store.db.$queryRaw<
      {
        review: bigint;
        unreconciled: bigint;
        uncertainPayouts: bigint;
        refunds: bigint;
        imbalanced: bigint;
        unknownFees: bigint;
        liability: bigint;
        platform: bigint;
      }[]
    >`
      SELECT
      (SELECT count(*) FROM commerce_orders WHERE status='review') AS review,
      (SELECT count(*) FROM commerce_orders o JOIN commerce_payments p ON p.order_id=o.id WHERE o.status IN ('paid','review') AND p.reconciled_at IS NULL) AS unreconciled,
      (SELECT count(*) FROM commerce_withdrawals WHERE status IN ('processing','pending','unknown')) AS "uncertainPayouts",
      (SELECT count(*) FROM commerce_refunds WHERE status IN ('pending','unknown')) AS refunds,
      (SELECT count(*) FROM (SELECT journal_id FROM commerce_entries GROUP BY journal_id HAVING sum(amount)<>0) j) AS imbalanced,
      (SELECT count(*) FROM commerce_orders WHERE settled_at IS NOT NULL AND fee_amount IS NULL) AS "unknownFees",
      COALESCE((SELECT sum(amount) FROM commerce_entries WHERE account IN ('pending','available','reserved','refund_held')),0)::bigint AS liability,
      COALESCE((SELECT sum(amount) FROM commerce_entries WHERE account IN ('platform','fees')),0)::bigint AS platform`;
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Number(value)]));
  }
  async recipient(
    userId: string,
    recipient: {
      method: 'bank' | 'momo' | 'vnpay';
      institutionCode: string;
      accountName: string;
      accountNumber: string;
      label: string;
      testReference: string;
    },
  ) {
    await this.store.db
      .$executeRaw`INSERT INTO commerce_recipients(user_id,label,test_reference,method,institution_code,account_name,account_number)
      VALUES (${userId}::uuid,${recipient.label},${recipient.testReference},${recipient.method},${recipient.institutionCode},${recipient.accountName},${recipient.accountNumber})
      ON CONFLICT(user_id) DO UPDATE SET label=EXCLUDED.label,test_reference=EXCLUDED.test_reference,
      method=EXCLUDED.method,institution_code=EXCLUDED.institution_code,account_name=EXCLUDED.account_name,
      account_number=EXCLUDED.account_number,updated_at=now()`;
    return recipient;
  }
  async withdraw(userId: string, amount: number, key: string, scenario: PayoutScenario) {
    this.providers.assertEnabled();
    return this.store.transaction(async (tx) => {
      await lock(tx, `wallet:${userId}`);
      const [existing] = await tx.$queryRaw<
        WithdrawalRow[]
      >`SELECT * FROM commerce_withdrawals WHERE instructor_id=${userId}::uuid AND idempotency_key=${key}::uuid`;
      if (existing) {
        if (existing.amount !== amount)
          throw new ConflictException('Khóa thao tác đã dùng với số tiền khác');
        return this.withdrawalView(existing);
      }
      const [policy] = await tx.$queryRaw<PolicyRow[]>`SELECT * FROM commerce_policy`;
      if (amount < policy.minimum_withdrawal)
        throw new BadRequestException(`Số tiền rút tối thiểu ${policy.minimum_withdrawal}đ`);
      if ((await balance(tx, userId, 'available')) < amount)
        throw new ConflictException('Số dư khả dụng không đủ');
      const [recipient] = await tx.$queryRaw<
        { label: string; test_reference: string; method: string; institution_code: string; account_name: string; account_number: string }[]
      >`SELECT label,test_reference,method,institution_code,account_name,account_number FROM commerce_recipients WHERE user_id=${userId}::uuid`;
      if (!recipient) throw new BadRequestException('Hãy thiết lập tài khoản nhận tiền trước khi tạo yêu cầu rút');
      const [row] = await tx.$queryRaw<
        WithdrawalRow[]
      >`INSERT INTO commerce_withdrawals(instructor_id,amount,idempotency_key,recipient_snapshot,scenario,status)
        VALUES (${userId}::uuid,${amount},${key}::uuid,${JSON.stringify({ label: recipient.label, testReference: recipient.test_reference, method: recipient.method, institutionCode: recipient.institution_code, accountName: recipient.account_name, accountNumber: recipient.account_number })}::jsonb,${scenario},${policy.approval_required ? 'requested' : 'approved'}) RETURNING *`;
      await journal(
        tx,
        `withdrawal.reserve:${row.id}`,
        [
          { owner: userId, account: 'available', amount: -amount },
          { owner: userId, account: 'reserved', amount },
        ],
        { withdrawal: row.id },
      );
      await audit(tx, 'withdrawal.requested', row.id, userId, { amount });
      return this.withdrawalView(row);
    });
  }
  async decide(adminId: string, id: string, approve: boolean, reason: string) {
    this.providers.assertEnabled();
    const row = await this.findWithdrawal(id);
    return this.store.transaction(async (tx) => {
      await lock(tx, `wallet:${row.instructor_id}`);
      const [current] = await tx.$queryRaw<
        WithdrawalRow[]
      >`SELECT * FROM commerce_withdrawals WHERE id=${id}::uuid FOR UPDATE`;
      if (current.status !== 'requested') throw new ConflictException('Yêu cầu đã được xử lý');
      if (!approve)
        await journal(
          tx,
          `withdrawal.release:${id}`,
          [
            { owner: row.instructor_id, account: 'reserved', amount: -row.amount },
            { owner: row.instructor_id, account: 'available', amount: row.amount },
          ],
          { withdrawal: id },
        );
      await tx.$executeRaw`UPDATE commerce_withdrawals SET status=${approve ? 'approved' : 'rejected'},reason=${reason},decided_by=${adminId}::uuid WHERE id=${id}::uuid`;
      await audit(tx, approve ? 'withdrawal.approved' : 'withdrawal.rejected', id, adminId, {
        reason,
      });
      return { status: approve ? 'approved' : 'rejected' };
    });
  }
  async processPayout(id: string) {
    this.providers.assertEnabled();
    const rows = await this.store.db.$queryRaw<
      WithdrawalRow[]
    >`UPDATE commerce_withdrawals SET status='processing',processed_at=now() WHERE id=${id}::uuid AND status='approved' RETURNING *`;
    if (!rows[0]) return;
    // A crash leaves 'processing': the worker never submits it again automatically.
    const result = await this.payout.send(id, rows[0].scenario);
    await this.finishPayout(id, result.result);
  }
  async finishPayout(id: string, result: ProviderResult) {
    this.providers.assertEnabled();
    const row = await this.findWithdrawal(id);
    await this.store.transaction(async (tx) => {
      await lock(tx, `wallet:${row.instructor_id}`);
      const [current] = await tx.$queryRaw<
        WithdrawalRow[]
      >`SELECT * FROM commerce_withdrawals WHERE id=${id}::uuid FOR UPDATE`;
      if (!['processing', 'pending', 'unknown'].includes(current.status)) return;
      const terminal = result === 'success' || result === 'failure';
      if (terminal)
        await journal(
          tx,
          `withdrawal.${result === 'success' ? 'paid' : 'release'}:${id}`,
          [
            { owner: row.instructor_id, account: 'reserved', amount: -row.amount },
            {
              owner: row.instructor_id,
              account: result === 'success' ? 'paid' : 'available',
              amount: row.amount,
            },
          ],
          { withdrawal: id },
        );
      await tx.$executeRaw`UPDATE commerce_withdrawals SET status=${result === 'success' ? 'succeeded' : result === 'failure' ? 'failed' : result === 'pending' ? 'pending' : 'unknown'} WHERE id=${id}::uuid`;
      await audit(tx, `payout.${result}`, id);
      if (terminal)
        await notifyCommerce(
          tx,
          row.instructor_id,
          id,
          result === 'success' ? 'Chi trả giả lập thành công' : 'Chi trả giả lập thất bại',
          result === 'success'
            ? 'Yêu cầu đã được ghi nhận chi trả thử nghiệm. Không có tiền thật được chuyển.'
            : 'Tiền đang giữ đã trả về số dư khả dụng.',
          '/earnings',
        );
    });
  }
  private async findWithdrawal(id: string) {
    const [row] = await this.store.db.$queryRaw<
      WithdrawalRow[]
    >`SELECT * FROM commerce_withdrawals WHERE id=${id}::uuid`;
    if (!row) throw new NotFoundException();
    return row;
  }
  private withdrawalView(row: WithdrawalRow) {
    return {
      id: row.id,
      amount: row.amount,
      status: row.status,
      scenario: row.scenario,
      recipient: row.recipient_snapshot,
      createdAt: row.created_at,
      reason: row.reason,
    };
  }
  async withdrawals(userId: string, page: number, admin = false, sort = 'newest') {
    const where = admin ? Prisma.sql`true` : Prisma.sql`instructor_id=${userId}::uuid`;
    const orderBy =
      sort === 'oldest'
        ? Prisma.sql`created_at ASC,id ASC`
        : sort === 'amount_high'
          ? Prisma.sql`amount DESC,created_at DESC,id`
          : sort === 'amount_low'
            ? Prisma.sql`amount ASC,created_at DESC,id`
            : Prisma.sql`created_at DESC,id`;
    const rows = await this.store.db.$queryRaw<WithdrawalRow[]>(
      Prisma.sql`SELECT * FROM commerce_withdrawals WHERE ${where} ORDER BY ${orderBy} LIMIT 20 OFFSET ${(page - 1) * 20}`,
    );
    const [count] = await this.store.db.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT count(*) AS total FROM commerce_withdrawals WHERE ${where}`,
    );
    return {
      items: rows.map((r) => this.withdrawalView(r)),
      page,
      total: Number(count.total),
      limit: 20,
    };
  }
  async releaseIncome(id: string) {
    this.providers.assertEnabled();
    const [order] = await this.store.db.$queryRaw<
      OrderRow[]
    >`SELECT * FROM commerce_orders WHERE id=${id}::uuid`;
    if (!order) return;
    await this.store.transaction(async (tx) => {
      await lock(tx, `wallet:${order.instructor_id}`);
      const [ready] = await tx.$queryRaw<
        OrderRow[]
      >`SELECT o.* FROM commerce_orders o JOIN commerce_payments p ON p.order_id=o.id
        WHERE o.id=${id}::uuid AND o.status='paid' AND o.income_state='pending' AND o.available_at<=now() AND p.reconciled_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.order_id=o.id AND r.status IN ('pending','unknown','succeeded')) FOR UPDATE OF o`;
      if (!ready) return;
      const debt = Math.min(
        ready.instructor_amount,
        Math.max(0, -(await balance(tx, order.instructor_id, 'debt'))),
      );
      await journal(
        tx,
        `income.release:${id}`,
        [
          { owner: order.instructor_id, account: 'pending', amount: -ready.instructor_amount },
          {
            owner: order.instructor_id,
            account: 'available',
            amount: ready.instructor_amount - debt,
          },
          { owner: order.instructor_id, account: 'debt', amount: debt },
        ],
        { order: id },
      );
      await tx.$executeRaw`UPDATE commerce_orders SET income_state='available' WHERE id=${id}::uuid`;
      await audit(tx, 'income.released', id, undefined, { debtOffset: debt });
    });
  }
  async refund(adminId: string, id: string, reason: string) {
    this.providers.assertEnabled();
    const [order] = await this.store.db.$queryRaw<
      OrderRow[]
    >`SELECT * FROM commerce_orders WHERE id=${id}::uuid`;
    if (!order) throw new NotFoundException();
    const [payment] = await this.store.db.$queryRaw<
      PaymentRow[]
    >`SELECT * FROM commerce_payments WHERE order_id=${id}::uuid`;
    if (payment.provider !== 'mock' && process.env.COMMERCE_SANDBOX_REFUNDS !== 'true')
      throw new BadRequestException('Chưa cấu hình quyền hoàn tiền sandbox');
    const prepared = await this.store.transaction(async (tx) => {
      await lock(tx, `wallet:${order.instructor_id}`);
      const [current] = await tx.$queryRaw<
        OrderRow[]
      >`SELECT * FROM commerce_orders WHERE id=${id}::uuid FOR UPDATE`;
      const [existing] = await tx.$queryRaw<
        RefundRow[]
      >`SELECT * FROM commerce_refunds WHERE order_id=${id}::uuid`;
      if (existing) return { row: existing, send: false };
      if (
        !['paid', 'review'].includes(current.status) ||
        !['pending', 'available'].includes(current.income_state)
      )
        throw new ConflictException('Giao dịch chưa thể hoàn tiền');
      if ((await balance(tx, order.instructor_id, 'reserved')) > 0)
        throw new ConflictException(
          'Cần đối soát yêu cầu rút đang giữ tiền của giảng viên trước khi hoàn tiền.',
        );
      const from = current.income_state === 'pending' ? 'pending' : 'available';
      const held =
        from === 'pending'
          ? order.instructor_amount
          : Math.min(
              order.instructor_amount,
              Math.max(0, await balance(tx, order.instructor_id, 'available')),
            );
      const [row] = await tx.$queryRaw<
        RefundRow[]
      >`INSERT INTO commerce_refunds(order_id,amount,reason,requested_by,held_amount,debt_amount,from_account)
        VALUES (${id}::uuid,${order.amount},${reason},${adminId}::uuid,${held},${order.instructor_amount - held},${from}) RETURNING *`;
      if (held)
        await journal(
          tx,
          `refund.reserve:${row.id}`,
          [
            { owner: order.instructor_id, account: from, amount: -held },
            { owner: order.instructor_id, account: 'refund_held', amount: held },
          ],
          { order: id, refund: row.id },
        );
      await tx.$executeRaw`UPDATE commerce_orders SET income_state='refund_held' WHERE id=${id}::uuid`;
      await audit(tx, 'refund.requested', row.id, adminId, { reason, amount: order.amount });
      return { row, send: true };
    });
    if (prepared.send) {
      let result: ProviderResult = 'unknown';
      try {
        result = await this.providers.refund(
          payment.provider,
          {
            id: payment.id,
            orderId: id,
            amount: order.amount,
            createdAt: payment.created_at,
            expiresAt: order.expires_at,
          },
          prepared.row.id,
          payment.provider_ref!,
        );
      } catch {
        /* Unknown: hold funds and never resubmit as a new refund. */
      }
      await this.finishRefund(prepared.row.id, result);
    }
    return { id: prepared.row.id };
  }
  async reconcileRefund(id: string) {
    this.providers.assertEnabled();
    const [r] = await this.store.db.$queryRaw<
      RefundRow[]
    >`SELECT * FROM commerce_refunds WHERE id=${id}::uuid`;
    if (!r) throw new NotFoundException();
    if (!['pending', 'unknown'].includes(r.status)) return;
    const [p] = await this.store.db.$queryRaw<
      PaymentRow[]
    >`SELECT * FROM commerce_payments WHERE order_id=${r.order_id}::uuid`;
    const [o] = await this.store.db.$queryRaw<
      OrderRow[]
    >`SELECT * FROM commerce_orders WHERE id=${r.order_id}::uuid`;
    const result = await this.providers.queryRefund(
      p.provider,
      {
        id: p.id,
        orderId: o.id,
        amount: o.amount,
        createdAt: p.created_at,
        expiresAt: o.expires_at,
      },
      r.id,
    );
    await this.finishRefund(id, result);
  }
  async finishRefund(id: string, result: ProviderResult) {
    this.providers.assertEnabled();
    const [refund] = await this.store.db.$queryRaw<
      RefundRow[]
    >`SELECT * FROM commerce_refunds WHERE id=${id}::uuid`;
    if (!refund) throw new NotFoundException();
    const [order] = await this.store.db.$queryRaw<
      OrderRow[]
    >`SELECT * FROM commerce_orders WHERE id=${refund.order_id}::uuid`;
    await this.store.transaction(async (tx) => {
      await lock(tx, `wallet:${order.instructor_id}`);
      const [r] = await tx.$queryRaw<
        RefundRow[]
      >`SELECT * FROM commerce_refunds WHERE id=${id}::uuid FOR UPDATE`;
      if (['succeeded', 'failed'].includes(r.status)) return;
      if (result === 'success') {
        await journal(
          tx,
          `refund.complete:${id}`,
          [
            { account: 'clearing', amount: order.amount },
            { account: 'platform', amount: -order.platform_amount },
            { owner: order.instructor_id, account: 'refund_held', amount: -r.held_amount },
            { owner: order.instructor_id, account: 'debt', amount: -r.debt_amount },
          ],
          { order: order.id, refund: id },
        );
        await tx.$executeRaw`UPDATE commerce_orders SET status='refunded',income_state='refunded' WHERE id=${order.id}::uuid`;
        await tx.$executeRaw`UPDATE course_access_grants SET revoked_at=now() WHERE order_id=${order.id}::uuid AND revoked_at IS NULL`;
      } else if (result === 'failure') {
        if (r.held_amount)
          await journal(
            tx,
            `refund.release:${id}`,
            [
              { owner: order.instructor_id, account: 'refund_held', amount: -r.held_amount },
              { owner: order.instructor_id, account: r.from_account, amount: r.held_amount },
            ],
            { order: order.id, refund: id },
          );
        await tx.$executeRaw`UPDATE commerce_orders SET income_state=${r.from_account} WHERE id=${order.id}::uuid`;
      }
      await tx.$executeRaw`UPDATE commerce_refunds SET status=${result === 'success' ? 'succeeded' : result === 'failure' ? 'failed' : 'unknown'} WHERE id=${id}::uuid`;
      await audit(tx, `refund.${result}`, id);
      if (result === 'success')
        await notifyCommerce(
          tx,
          order.buyer_id,
          order.id,
          'Đã hoàn tiền thử nghiệm',
          `Giao dịch “${order.course_title.slice(0, 200)}” đã được hoàn toàn bộ. Các quyền học độc lập vẫn được giữ.`,
          `/purchases/${order.id}`,
        );
    });
  }
  async ledger(userId: string, page: number, admin = false, sort = 'newest') {
    const where = admin ? Prisma.sql`true` : Prisma.sql`e.owner_id=${userId}::uuid`;
    const orderBy =
      sort === 'oldest'
        ? Prisma.sql`e.id ASC`
        : sort === 'amount_high'
          ? Prisma.sql`abs(e.amount) DESC,e.id DESC`
          : sort === 'amount_low'
            ? Prisma.sql`abs(e.amount) ASC,e.id DESC`
            : Prisma.sql`e.id DESC`;
    const rows = await this.store.db.$queryRaw<
      {
        id: bigint;
        account: string;
        amount: bigint;
        event: string;
        created_at: Date;
        order_id: string | null;
        withdrawal_id: string | null;
      }[]
    >(Prisma.sql`
      SELECT e.id,e.account,e.amount,j.event_key AS event,j.created_at,j.order_id,j.withdrawal_id FROM commerce_entries e
      JOIN commerce_journals j ON j.id=e.journal_id WHERE ${where} ORDER BY ${orderBy} LIMIT 20 OFFSET ${(page - 1) * 20}`);
    const [count] = await this.store.db.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT count(*) AS total FROM commerce_entries e WHERE ${where}`,
    );
    return {
      items: rows.map((r) => ({
        id: String(r.id),
        account: r.account,
        amount: Number(r.amount),
        event: r.event,
        createdAt: r.created_at,
        orderId: r.order_id,
        withdrawalId: r.withdrawal_id,
      })),
      page,
      limit: 20,
      total: Number(count.total),
    };
  }
}
