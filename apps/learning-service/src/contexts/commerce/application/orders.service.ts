import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { notifyCommerce } from '../infrastructure/commerce-notification';
import { requiresPaymentReview } from '../domain/money';
import { Prisma } from '@prisma/client';
import { splitRevenue, type PaymentProvider, type PaymentEvidence } from '../domain/money';
import { PaymentProviders, ProviderQueryMismatch } from '../infrastructure/payment-providers';
import {
  CommerceStore,
  lock,
  journal,
  audit,
  orderView,
  OrderRow,
  PaymentRow,
  PolicyRow,
} from '../infrastructure/commerce.store';

@Injectable()
export class OrdersService {
  constructor(
    private readonly store: CommerceStore,
    private readonly providers: PaymentProviders,
  ) {}
  async create(buyerId: string, courseId: string, provider: PaymentProvider) {
    this.providers.assertEnabled();
    if (!this.providers.methods().includes(provider))
      throw new BadRequestException('Phương thức thanh toán chưa sẵn sàng');
    const order = await this.store.transaction(async (tx) => {
      await lock(tx, `course:${courseId}`);
      await lock(tx, `buyer:${buyerId}:${courseId}`);
      const grants = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM course_access_grants WHERE user_id=${buyerId}::uuid AND course_id=${courseId}::uuid AND revoked_at IS NULL`;
      if (grants.length) throw new ConflictException('Bạn đã có quyền học khóa này.');
      const [course] = await tx.$queryRaw<
        { title: string; instructor: string; price: number; list_price: number; version: number; promotion: unknown }[]
      >`SELECT c.title,c.created_by AS instructor,p.price_vnd AS list_price,p.version,
          CASE WHEN pr.is_active AND now() >= pr.starts_at AND now() < pr.ends_at AND pr.sale_price_vnd < p.price_vnd
            THEN jsonb_build_object('label',pr.label,'salePriceVnd',pr.sale_price_vnd,'startsAt',pr.starts_at,'endsAt',pr.ends_at,'version',pr.updated_at)
            ELSE NULL END AS promotion,
          CASE WHEN pr.is_active AND now() >= pr.starts_at AND now() < pr.ends_at
            AND pr.sale_price_vnd < p.price_vnd THEN pr.sale_price_vnd ELSE p.price_vnd END AS price
        FROM courses c JOIN course_prices p ON p.course_id=c.id
        LEFT JOIN course_promotions pr ON pr.course_id=c.id
        WHERE c.id=${courseId}::uuid AND c.status='published' AND p.price_vnd>0`;
      if (!course || !course.instructor) throw new BadRequestException('Khóa học không mở bán');
      if (course.instructor === buyerId)
        throw new BadRequestException('Không thể mua khóa học của chính mình');
      await tx.$executeRaw`UPDATE commerce_orders SET status='expired' WHERE buyer_id=${buyerId}::uuid AND course_id=${courseId}::uuid AND status='pending' AND expires_at<=now()`;
      const [open] = await tx.$queryRaw<
        OrderRow[]
      >`SELECT * FROM commerce_orders WHERE buyer_id=${buyerId}::uuid AND course_id=${courseId}::uuid AND status='pending'`;
      if (open) return open;
      const [policy] = await tx.$queryRaw<PolicyRow[]>`SELECT * FROM commerce_policy`;
      const share = splitRevenue(course.price, policy.instructor_bps);
      const pricingSnapshot = { originalPriceVnd: course.list_price, discountVnd: course.list_price - course.price,
        finalAmountVnd: course.price, priceVersion: course.version, promotion: course.promotion };
      const [row] = await tx.$queryRaw<
        OrderRow[]
      >`INSERT INTO commerce_orders(buyer_id,course_id,instructor_id,course_title,amount,instructor_bps,instructor_amount,platform_amount,hold_days,hold_minutes,mode,pricing_snapshot)
        VALUES (${buyerId}::uuid,${courseId}::uuid,${course.instructor}::uuid,${course.title},${course.price},${policy.instructor_bps},${share.instructor},${share.platform},${policy.hold_days},${policy.hold_minutes ?? policy.hold_days * 1440},${this.providers.mode},${JSON.stringify(pricingSnapshot)}::jsonb) RETURNING *`;
      await tx.$executeRaw`INSERT INTO commerce_payments(order_id,provider) VALUES (${row.id}::uuid,${provider})`;
      await audit(tx, 'order.created', row.id, buyerId);
      return row;
    });
    const [payment] = await this.store.db.$queryRaw<
      PaymentRow[]
    >`SELECT * FROM commerce_payments WHERE order_id=${order.id}::uuid`;
    const claimed = await this.store.db.$queryRaw<
      { id: string }[]
    >`UPDATE commerce_payments SET create_started_at=now() WHERE id=${payment.id}::uuid AND create_started_at IS NULL AND status='pending' RETURNING id`;
    if (claimed.length) {
      // Unknown create outcomes are queried using the SAME payment id; never make a fresh charge.
      try {
        const url = await this.providers.create(payment.provider, {
          id: payment.id,
          orderId: order.id,
          amount: order.amount,
          createdAt: payment.created_at,
          expiresAt: order.expires_at,
        });
        await this.store.db
          .$executeRaw`UPDATE commerce_payments SET checkout_url=${url} WHERE id=${payment.id}::uuid`;
      } catch {
        await this.store.db
          .$executeRaw`UPDATE commerce_payments SET status='unknown' WHERE id=${payment.id}::uuid AND status='pending'`;
      }
    }
    return this.detail(buyerId, order.id);
  }
  async detail(userId: string, id: string, admin = false) {
    const [order] = await this.store.db.$queryRaw<
      OrderRow[]
    >`SELECT o.*,u.display_name AS buyer_name,u.email::text AS buyer_email,
        c.cover_image_url AS course_cover_image_url,
        p.reconciled_at AS payment_reconciled_at, q.next_query_at, o.available_at<=now() AS hold_expired,
        EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.order_id=o.id AND r.status IN ('pending','unknown','succeeded')) AS refund_blocked
      FROM commerce_orders o JOIN users u ON u.id=o.buyer_id JOIN courses c ON c.id=o.course_id
      LEFT JOIN commerce_payments p ON p.order_id=o.id
      LEFT JOIN commerce_provider_query_leases q ON q.payment_id=p.id
      WHERE o.id=${id}::uuid AND (${admin} OR o.buyer_id=${userId}::uuid)`;
    if (!order) throw new NotFoundException('Không tìm thấy giao dịch');
    const [payment] = await this.store.db.$queryRaw<
      PaymentRow[]
    >`SELECT * FROM commerce_payments WHERE order_id=${id}::uuid`;
    const refunds = await this.store.db.$queryRaw<
      { id: string; status: string; reason: string }[]
    >`SELECT id,status,reason FROM commerce_refunds WHERE order_id=${id}::uuid`;
    return {
      ...orderView(order),
      payment: {
        id: payment.id,
        provider: payment.provider,
        status: payment.status,
        checkoutUrl: order.status === 'pending' ? payment.checkout_url : null,
      },
      refund: refunds[0] ?? null,
    };
  }
  async list(userId: string, page: number, scope: 'buyer' | 'instructor' | 'admin', filters: { status?: string; q?: string; courseId?: string; sort?: string } = {}) {
    const where =
      scope === 'admin'
        ? Prisma.sql`true`
        : scope === 'buyer'
          ? Prisma.sql`o.buyer_id=${userId}::uuid`
          : Prisma.sql`o.instructor_id=${userId}::uuid`;
    const status = filters.status ? Prisma.sql`AND o.status=${filters.status}` : Prisma.empty;
    const course = filters.courseId ? Prisma.sql`AND o.course_id=${filters.courseId}::uuid` : Prisma.empty;
    const search = filters.q?.trim()
      ? Prisma.sql`AND (o.course_title ILIKE ${`%${filters.q.trim()}%`} OR u.display_name ILIKE ${`%${filters.q.trim()}%`} OR u.email::text ILIKE ${`%${filters.q.trim()}%`})`
      : Prisma.empty;
    const orderBy =
      filters.sort === 'oldest'
        ? Prisma.sql`o.created_at ASC,o.id ASC`
        : filters.sort === 'amount_high'
          ? Prisma.sql`o.amount DESC,o.created_at DESC,o.id`
          : filters.sort === 'amount_low'
            ? Prisma.sql`o.amount ASC,o.created_at DESC,o.id`
            : Prisma.sql`o.created_at DESC,o.id`;
    const [rows, count] = await Promise.all([
      this.store.db.$queryRaw<OrderRow[]>(
        Prisma.sql`SELECT o.*,u.display_name AS buyer_name,u.email::text AS buyer_email,
          c.cover_image_url AS course_cover_image_url,
          p.reconciled_at AS payment_reconciled_at, q.next_query_at, o.available_at<=now() AS hold_expired,
          EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.order_id=o.id AND r.status IN ('pending','unknown','succeeded')) AS refund_blocked
          FROM commerce_orders o JOIN users u ON u.id=o.buyer_id JOIN courses c ON c.id=o.course_id
          LEFT JOIN commerce_payments p ON p.order_id=o.id
          LEFT JOIN commerce_provider_query_leases q ON q.payment_id=p.id
          WHERE ${where} ${status} ${course} ${search} ORDER BY ${orderBy} LIMIT 20 OFFSET ${(page - 1) * 20}`,
      ),
      this.store.db.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM commerce_orders o JOIN users u ON u.id=o.buyer_id WHERE ${where} ${status} ${course} ${search}`,
      ),
    ]);
    return { items: rows.map(orderView), total: Number(count[0].total), page, limit: 20 };
  }
  async listForCourse(instructorId: string, courseId: string, page: number, filters: { status?: string; q?: string; sort?: string }) {
    const [course] = await this.store.db.$queryRaw<{ id: string }[]>`SELECT id FROM courses WHERE id=${courseId}::uuid AND created_by=${instructorId}::uuid`;
    if (!course) throw new NotFoundException('Không tìm thấy khóa học của bạn');
    const [orders, totals] = await Promise.all([
      this.list(instructorId, page, 'instructor', { ...filters, courseId }),
      this.store.db.$queryRaw<{ paid_count: bigint; gross_amount: bigint; instructor_amount: bigint }[]>`
        SELECT count(DISTINCT buyer_id)::bigint AS paid_count,coalesce(sum(amount),0)::bigint AS gross_amount,
          coalesce(sum(instructor_amount),0)::bigint AS instructor_amount
        FROM commerce_orders WHERE course_id=${courseId}::uuid AND instructor_id=${instructorId}::uuid AND status='paid'`,
    ]);
    return { ...orders, summary: {
      paidCount: Number(totals[0].paid_count),
      grossAmount: Number(totals[0].gross_amount),
      instructorAmount: Number(totals[0].instructor_amount),
    } };
  }
  async apply(provider: PaymentProvider, e: PaymentEvidence, reconciled = false) {
    this.providers.assertEnabled();
    if (
      !Number.isSafeInteger(e.amount) ||
      e.amount <= 0 ||
      (!e.reference && e.result === 'success')
    )
      throw new BadRequestException('Kết quả thanh toán không hợp lệ');
    const [payment] = await this.store.db.$queryRaw<
      PaymentRow[]
    >`SELECT * FROM commerce_payments WHERE id=${e.paymentId}::uuid AND provider=${provider}`;
    if (!payment) {
      await this.recordIssue(provider, e, 'unknown_payment', null);
      throw new NotFoundException('Không tìm thấy lần thanh toán');
    }
    const [snapshot] = await this.store.db.$queryRaw<
      OrderRow[]
    >`SELECT * FROM commerce_orders WHERE id=${payment.order_id}::uuid`;
    if (snapshot.amount !== e.amount || (provider === 'mock') !== (snapshot.mode === 'mock')) {
      await this.recordIssue(provider, e, 'amount_or_environment_mismatch', payment.id, { expectedAmount: snapshot.amount });
      throw new BadRequestException('Số tiền hoặc môi trường không khớp');
    }
    return this.store.transaction(async (tx) => {
      await lock(tx, `buyer:${snapshot.buyer_id}:${snapshot.course_id}`);
      await lock(tx, `wallet:${snapshot.instructor_id}`);
      const [order] = await tx.$queryRaw<
        OrderRow[]
      >`SELECT * FROM commerce_orders WHERE id=${snapshot.id}::uuid FOR UPDATE`;
      const [currentPayment] = await tx.$queryRaw<
        PaymentRow[]
      >`SELECT * FROM commerce_payments WHERE id=${payment.id}::uuid FOR UPDATE`;
      if (order.amount !== e.amount || (provider === 'mock') !== (order.mode === 'mock'))
        throw new BadRequestException('Số tiền hoặc môi trường không khớp');
      if (e.result === 'success') {
        await lock(tx, `provider-reference:${provider}:${e.reference}`);
        const [duplicate] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM commerce_payments
          WHERE provider=${provider} AND provider_ref=${e.reference} AND id<>${payment.id}::uuid`;
        if (duplicate || (currentPayment.provider_ref && currentPayment.provider_ref !== e.reference)) {
          await this.issue(tx, provider, e, duplicate ? 'duplicate_reference' : 'reference_mismatch', payment.id);
          await tx.$executeRaw`UPDATE commerce_payments SET reconciled_at=NULL WHERE id=${payment.id}::uuid`;
          return { quarantined: true };
        }
      }
      // A query conflicting with recorded success cannot erase ledger history or unlock income.
      if (order.income_state !== 'none' && (['failure', 'cancelled'].includes(e.result) || (reconciled && e.result !== 'success'))) {
        await this.issue(tx, provider, e, 'status_conflict', payment.id, { internal: currentPayment.status, reconciled });
        await tx.$executeRaw`UPDATE commerce_payments SET reconciled_at=NULL WHERE id=${payment.id}::uuid`;
        return { quarantined: true };
      }
      const events = await tx.$queryRaw<
        { id: string }[]
      >`INSERT INTO commerce_provider_events(payment_id,fingerprint,result)
        VALUES (${payment.id}::uuid,${e.fingerprint},${e.result}) ON CONFLICT DO NOTHING RETURNING id`;
      if (!events.length) {
        if (reconciled && e.result === 'success' && currentPayment.status === 'succeeded')
          await tx.$executeRaw`UPDATE commerce_payments SET reconciled_at=now() WHERE id=${payment.id}::uuid`;
        return { duplicate: true };
      }
      if (order.income_state !== 'none') {
        if (
          e.result === 'success' &&
          currentPayment.provider_ref &&
          currentPayment.provider_ref !== e.reference
        )
          throw new ConflictException('Mã giao dịch không khớp kết quả đã ghi nhận');
        if (reconciled && e.result === 'success')
          await tx.$executeRaw`UPDATE commerce_payments SET reconciled_at=now() WHERE id=${payment.id}::uuid`;
        return { duplicate: true };
      }
      if (e.result === 'success') {
        // A late success is real money. Keep it for admin review/refund when entitlement already exists.
        const [existing] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM course_access_grants WHERE user_id=${order.buyer_id}::uuid AND course_id=${order.course_id}::uuid AND revoked_at IS NULL`;
        const review = requiresPaymentReview(order, !!existing, e);
        await tx.$executeRaw`UPDATE commerce_payments SET status='succeeded',provider_ref=${e.reference},reconciled_at=${reconciled || provider === 'mock' ? new Date() : null} WHERE id=${payment.id}::uuid`;
        // record once, including late/review payments; reviewers can refund them without pretending money never arrived.
        await journal(
          tx,
          `payment:${payment.id}`,
          [
            { account: 'clearing', amount: -order.amount },
            { owner: order.instructor_id, account: 'pending', amount: order.instructor_amount },
            { account: 'platform', amount: order.platform_amount },
          ],
          { order: order.id },
        );
        await tx.$executeRaw`UPDATE commerce_orders SET status=${review ? 'review' : 'paid'},income_state='pending',
          available_at=now()+make_interval(mins=>COALESCE(hold_minutes,hold_days*1440)),settled_at=now(),fee_amount=${provider === 'mock' ? 0 : null},fee_source=${provider === 'mock' ? 'simulated' : 'unknown'} WHERE id=${order.id}::uuid`;
        if (!review) {
          await tx.$executeRaw`INSERT INTO course_access_grants(user_id,course_id,source,order_id) VALUES (${order.buyer_id}::uuid,${order.course_id}::uuid,'purchase',${order.id}::uuid) ON CONFLICT DO NOTHING`;
          await tx.$executeRaw`INSERT INTO course_enrollments(user_id,course_id) VALUES (${order.buyer_id}::uuid,${order.course_id}::uuid)
            ON CONFLICT(user_id,course_id) DO UPDATE SET status=CASE WHEN course_enrollments.status='dropped' THEN 'active'::enrollment_status ELSE course_enrollments.status END,
            completed_at=CASE WHEN course_enrollments.status='dropped' THEN NULL ELSE course_enrollments.completed_at END`;
        }
        await audit(tx, review ? 'payment.review' : 'payment.succeeded', order.id, undefined, {
          provider,
          reference: e.reference,
        });
        await notifyCommerce(
          tx,
          order.buyer_id,
          order.id,
          review ? 'Thanh toán cần kiểm tra' : 'Đã mua khóa học',
          review
            ? 'Khoản thanh toán đến muộn hoặc quyền học đã tồn tại. Quản trị viên sẽ kiểm tra.'
            : `Bạn đã được cấp quyền học “${order.course_title.slice(0, 200)}”.`,
          `/purchases/${order.id}`,
        );
        if (!review) {
          const [buyer] = await tx.$queryRaw<{ display_name: string }[]>`SELECT display_name FROM users WHERE id=${order.buyer_id}::uuid`;
          await notifyCommerce(
            tx,
            order.instructor_id,
            order.id,
            'Có học viên mua khóa học',
            `${buyer?.display_name ?? 'Một học viên'} đã mua “${order.course_title.slice(0, 200)}” (${order.amount.toLocaleString('vi-VN')} ₫).`,
            `/courses/${order.course_id}/studio?tab=purchases`,
          );
        }
      } else if (order.status === 'pending' && ['failure', 'cancelled'].includes(e.result)) {
        await tx.$executeRaw`UPDATE commerce_orders SET status=${e.result === 'failure' ? 'failed' : 'cancelled'} WHERE id=${order.id}::uuid`;
        await tx.$executeRaw`UPDATE commerce_payments SET status=${e.result === 'failure' ? 'failed' : 'cancelled'} WHERE id=${payment.id}::uuid`;
        await audit(tx, `payment.${e.result}`, order.id);
      } else if (order.status === 'pending' && e.result === 'unknown') {
        await tx.$executeRaw`UPDATE commerce_payments SET status='unknown' WHERE id=${payment.id}::uuid AND status='pending'`;
      }
    });
  }
  private async issue(tx: Prisma.TransactionClient, provider: PaymentProvider, evidence: PaymentEvidence, kind: string, paymentId: string | null, details: unknown = {}) {
    const [created] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO commerce_reconciliation_issues(payment_id,provider,kind,fingerprint,details)
      VALUES (${paymentId}::uuid,${provider},${kind},${evidence.fingerprint},${JSON.stringify({ ...evidence, context: details })}::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`;
    if (created) await audit(tx, `reconciliation.${kind}`, paymentId, undefined, { evidence, details });
  }
  private async recordIssue(provider: PaymentProvider, evidence: PaymentEvidence, kind: string, paymentId: string | null, details: unknown = {}) {
    await this.store.transaction(async (tx) => {
      if (paymentId) {
        const [order] = await tx.$queryRaw<{ instructor_id: string }[]>`SELECT o.instructor_id FROM commerce_orders o
          JOIN commerce_payments p ON p.order_id=o.id WHERE p.id=${paymentId}::uuid`;
        if (order) await lock(tx, `wallet:${order.instructor_id}`);
        await tx.$executeRaw`UPDATE commerce_payments SET reconciled_at=NULL WHERE id=${paymentId}::uuid`;
      }
      await this.issue(tx, provider, evidence, kind, paymentId, details);
    });
  }
  async mock(
    userId: string,
    id: string,
    result: 'success' | 'failure' | 'cancelled' | 'pending' | 'unknown',
  ) {
    this.providers.assertMock();
    const detail = await this.detail(userId, id);
    if (detail.payment.provider !== 'mock') throw new BadRequestException();
    await this.apply(
      'mock',
      {
        paymentId: detail.payment.id,
        amount: detail.amount,
        reference: `mock-${detail.payment.id}`,
        result,
        fingerprint: `mock:${detail.payment.id}:${result}`,
      },
      true,
    );
    return this.detail(userId, id);
  }
  async reconcile(id: string) {
    const [p] = await this.store.db.$queryRaw<
      PaymentRow[]
    >`SELECT * FROM commerce_payments WHERE order_id=${id}::uuid`;
    const [o] = await this.store.db.$queryRaw<
      OrderRow[]
    >`SELECT * FROM commerce_orders WHERE id=${id}::uuid`;
    if (!p || !o) throw new NotFoundException();
    let e: PaymentEvidence | null;
    try { e = await this.providers.query(p.provider, {
      id: p.id,
      orderId: o.id,
      amount: o.amount,
      createdAt: p.created_at,
      expiresAt: o.expires_at,
    }); } catch (error) {
      if (error instanceof ProviderQueryMismatch || error instanceof BadRequestException) {
        const kind = error instanceof ProviderQueryMismatch ? error.kind : 'invalid_gateway_payload';
        await this.recordIssue(p.provider, { paymentId: p.id, amount: o.amount, reference: '', result: 'unknown',
          fingerprint: createHash('sha256').update(`${p.id}:${kind}`).digest('hex') }, kind, p.id);
      }
      throw error;
    }
    if (e) {
      if (e.paymentId !== p.id) {
        await this.recordIssue(p.provider, e, 'reference_mismatch', p.id);
        throw new ConflictException('Mã thanh toán trả về không khớp yêu cầu đối soát');
      }
      await this.apply(p.provider, { ...e, fingerprint: `query:${e.fingerprint}` }, true);
    }
  }
}
