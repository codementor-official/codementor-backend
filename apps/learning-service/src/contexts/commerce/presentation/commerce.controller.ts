import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Param,
  ParseUUIDPipe,
  HttpCode,
  Res,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { confirmVnpayIpn } from './vnpay-ipn';
import { Prisma } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
  Public,
  Roles,
  requireHumanId,
} from '@codementor/platform';
import { OrdersService } from '../application/orders.service';
import { WalletService } from '../application/wallet.service';
import { RevenueAnalyticsService } from '../application/revenue-analytics.service';
import { CommerceAccessService } from '../application/commerce-access.service';
import { CommerceJobs } from '../application/commerce.jobs';
import { CommerceStore, audit } from '../infrastructure/commerce.store';
import { PaymentProviders } from '../infrastructure/payment-providers';
import {
  CommercePage,
  RevenuePeriod,
  AdminRevenuePeriod,
  CreateOrderDto,
  DecisionDto,
  ManualGrantDto,
  MockResultDto,
  PolicyDto,
  PriceDto,
  PromotionDto,
  BatchPromotionDto,
  ReasonDto,
  RecipientDto,
  WithdrawDto,
} from './commerce.dto';

@Controller({ path: 'commerce', version: '1' })
export class CommerceController {
  constructor(
    private readonly orders: OrdersService,
    private readonly wallets: WalletService,
    private readonly access: CommerceAccessService,
    private readonly providers: PaymentProviders,
    private readonly store: CommerceStore,
    private readonly jobs: CommerceJobs,
    private readonly analytics: RevenueAnalyticsService,
  ) {}
  @Get('config') config() {
    const methods = this.providers.methods();
    return {
      methods,
      mode: this.providers.mode,
      label: methods.length
        ? 'Thanh toán trực tuyến'
        : 'Thanh toán trực tuyến chưa được cấu hình',
    };
  }
  @Get('courses/:id') offer(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.access.offer(requireHumanId(u), id, u.role === 'admin');
  }
  @Put('courses/:id/price') @Roles('lecturer') price(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: PriceDto,
  ) {
    return this.access.setPrice(u, id, b.priceVnd);
  }
  @Get('promotions') @Roles('lecturer') promotions(@CurrentUser() u: AuthenticatedUser) {
    return this.access.promotions(requireHumanId(u), false);
  }
  @Put('promotions/batch') @Roles('lecturer') lecturerBatchPromotion(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: BatchPromotionDto,
  ) {
    return this.access.requestPromotionsBatch(u, b);
  }
  @Put('courses/:id/promotion') @Roles('lecturer') promotion(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: PromotionDto,
  ) {
    return this.access.setPromotion(u, id, b);
  }
  @Post('courses/:id/promotion/remove') @Roles('lecturer') removePromotion(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.access.removePromotion(u, id);
  }
  @Post('orders') create(@CurrentUser() u: AuthenticatedUser, @Body() b: CreateOrderDto) {
    return this.orders.create(requireHumanId(u), b.courseId, b.provider);
  }
  @Get('orders') list(@CurrentUser() u: AuthenticatedUser, @Query() q: CommercePage) {
    return this.orders.list(requireHumanId(u), q.page, 'buyer', q);
  }
  @Get('orders/:id') detail(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.detail(requireHumanId(u), id);
  }
  @Post('orders/:id/reconcile') async reconcile(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.orders.detail(requireHumanId(u), id);
    await this.orders.reconcile(id);
    return this.orders.detail(requireHumanId(u), id);
  }
  @Post('orders/:id/mock') mock(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: MockResultDto,
  ) {
    return this.orders.mock(requireHumanId(u), id, b.result);
  }
  @Get('wallet') @Roles('lecturer') wallet(@CurrentUser() u: AuthenticatedUser) {
    return this.wallets.summary(requireHumanId(u));
  }
  @Get('wallet/analytics') @Roles('lecturer') revenue(
    @CurrentUser() u: AuthenticatedUser, @Query() q: RevenuePeriod,
  ) {
    return this.analytics.report(q.days, requireHumanId(u), undefined, { from: q.from, to: q.to });
  }
  @Get('admin/analytics') @Roles('admin') adminRevenue(@Query() q: AdminRevenuePeriod) {
    return this.analytics.report(q.days, q.instructorId, 'admin', { from: q.from, to: q.to });
  }
  @Get('admin/analytics/instructors') @Roles('admin') revenueInstructors(@Query() q: RevenuePeriod) {
    return this.analytics.instructors(q.days, { from: q.from, to: q.to });
  }
  @Put('wallet/recipient') @Roles('lecturer') recipient(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: RecipientDto,
  ) {
    return this.wallets.recipient(requireHumanId(u), b);
  }
  @Get('wallet/orders') @Roles('lecturer') income(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CommercePage,
  ) {
    return this.orders.list(requireHumanId(u), q.page, 'instructor', q);
  }
  @Get('wallet/courses/:id/orders') @Roles('lecturer') courseOrders(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CommercePage,
  ) {
    return this.orders.listForCourse(requireHumanId(u), id, q.page, q);
  }
  @Get('wallet/ledger') @Roles('lecturer') ledger(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CommercePage,
  ) {
    return this.wallets.ledger(requireHumanId(u), q.page, false, q.sort);
  }
  @Get('wallet/withdrawals') @Roles('lecturer') withdrawals(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CommercePage,
  ) {
    return this.wallets.withdrawals(requireHumanId(u), q.page, false, q.sort);
  }
  @Post('wallet/withdrawals') @Roles('lecturer') withdraw(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: WithdrawDto,
  ) {
    return this.wallets.withdraw(requireHumanId(u), b.amount, b.idempotencyKey, b.scenario);
  }
  @Get('admin/orders') @Roles('admin') adminOrders(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CommercePage,
  ) {
    return this.orders.list(requireHumanId(u), q.page, 'admin', q);
  }
  @Get('admin/promotions') @Roles('admin') adminPromotions(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.access.promotions(requireHumanId(u), true);
  }
  @Put('admin/courses/:id/promotion') @Roles('admin') adminPromotion(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: PromotionDto,
  ) {
    return this.access.setPromotion(u, id, b);
  }
  @Put('admin/promotions/batch') @Roles('admin') adminBatchPromotion(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: BatchPromotionDto,
  ) {
    return this.access.setPromotionsBatch(u, b);
  }
  @Post('admin/courses/:id/promotion/remove') @Roles('admin') adminRemovePromotion(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.access.removePromotion(u, id);
  }
  @Post('admin/promotion-requests/:id/decide') @Roles('admin') decidePromotion(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
  ) {
    return this.access.decidePromotionRequest(u, id, b.approve, b.reason);
  }
  @Get('admin/orders/:id') @Roles('admin') adminOrder(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.detail(requireHumanId(u), id, true);
  }
  @Post('admin/orders/:id/reconcile') @Roles('admin') adminReconcile(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.reconcile(id);
  }
  @Post('admin/orders/:id/refund') @Roles('admin') refund(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ReasonDto,
  ) {
    return this.wallets.refund(requireHumanId(u), id, b.reason);
  }
  @Get('admin/withdrawals') @Roles('admin') adminWithdrawals(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CommercePage,
  ) {
    return this.wallets.withdrawals(requireHumanId(u), q.page, true, q.sort);
  }
  @Post('admin/withdrawals/:id/decide') @Roles('admin') decide(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
  ) {
    return this.wallets.decide(requireHumanId(u), id, b.approve, b.reason);
  }
  @Post('admin/withdrawals/:id/mock-result') @Roles('admin') async payoutResult(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: MockResultDto,
  ) {
    this.providers.assertEnabled();
    await this.store.transaction((tx) =>
      audit(tx, 'payout.mock-control', id, requireHumanId(u), { result: b.result }),
    );
    return this.wallets.finishPayout(id, b.result);
  }
  @Post('admin/refunds/:id/mock-result') @Roles('admin') async refundResult(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: MockResultDto,
  ) {
    this.providers.assertMock();
    await this.store.transaction((tx) =>
      audit(tx, 'refund.mock-control', id, requireHumanId(u), { result: b.result }),
    );
    return this.wallets.finishRefund(id, b.result);
  }
  @Get('admin/ledger') @Roles('admin') adminLedger(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: CommercePage,
  ) {
    return this.wallets.ledger(requireHumanId(u), q.page, true, q.sort);
  }
  @Post('admin/refunds/:id/reconcile') @Roles('admin') refundReconcile(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.wallets.reconcileRefund(id);
  }
  @Get('admin/reconciliation') @Roles('admin') reconciliation() {
    return this.wallets.reconciliation();
  }
  @Get('admin/policy') @Roles('admin') async policy() {
    const [p] = await this.store.db.$queryRaw<
      {
        instructor_bps: number;
        hold_days: number;
        minimum_withdrawal: number;
        approval_required: boolean;
      }[]
    >`SELECT * FROM commerce_policy`;
    return {
      instructorBps: p.instructor_bps,
      holdDays: p.hold_days,
      minimumWithdrawal: p.minimum_withdrawal,
      approvalRequired: p.approval_required,
    };
  }
  @Put('admin/policy') @Roles('admin') async setPolicy(
    @CurrentUser() u: AuthenticatedUser,
    @Body() p: PolicyDto,
  ) {
    await this.store.transaction(async (tx) => {
      await tx.$executeRaw`UPDATE commerce_policy SET instructor_bps=${p.instructorBps},hold_days=${p.holdDays},minimum_withdrawal=${p.minimumWithdrawal},approval_required=${p.approvalRequired},updated_at=now()`;
      await audit(tx, 'policy.updated', null, requireHumanId(u), p);
    });
    return p;
  }
  @Post('admin/grants') @Roles('admin') async grant(
    @CurrentUser() u: AuthenticatedUser,
    @Body() b: ManualGrantDto,
  ) {
    this.providers.assertEnabled();
    await this.store.transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO course_access_grants(user_id,course_id,source) VALUES (${b.userId}::uuid,${b.courseId}::uuid,'manual') ON CONFLICT DO NOTHING`;
      await audit(tx, 'access.manual', b.courseId, requireHumanId(u), {
        userId: b.userId,
        reason: b.reason,
      });
    });
    return { granted: true };
  }
  @Get('admin/audit') @Roles('admin') async audits(@Query() q: CommercePage) {
    const order = q.sort === 'oldest'
      ? Prisma.sql`created_at ASC,id ASC`
      : Prisma.sql`created_at DESC,id DESC`;
    const rows = await this.store.db
      .$queryRaw`SELECT id,action,entity_id AS "entityId",details,created_at AS "createdAt" FROM commerce_audit ORDER BY ${order} LIMIT 20 OFFSET ${(q.page - 1) * 20}`;
    const [count] = await this.store.db.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM commerce_audit`;
    return { items: rows, total: Number(count.n), page: q.page, limit: 20 };
  }
  @Post('admin/jobs/run') @Roles('admin') async run() {
    this.providers.assertEnabled();
    return this.jobs.tick();
  }
  @Get('admin/jobs/run') @Roles('admin') runMethodInfo(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Allow', 'POST');
    throw new HttpException(
      'Chạy đối soát cần POST từ nút xác nhận trên trang Quản lý giao dịch. GET không khởi chạy tác vụ.',
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }
  @Public() @Get('webhooks/vnpay') async vnpay(
    @Query() q: Record<string, string>,
    @Res() reply: FastifyReply,
  ) {
    return reply.code(200).send(await confirmVnpayIpn(this.providers, this.orders, q));
  }
  @Public() @Post('webhooks/momo') @HttpCode(204) async momo(@Body() b: unknown) {
    const result = await this.orders.apply('momo', this.providers.verify('momo', b));
    if (result?.quarantined) throw new BadRequestException('Payment requires review');
  }
}
