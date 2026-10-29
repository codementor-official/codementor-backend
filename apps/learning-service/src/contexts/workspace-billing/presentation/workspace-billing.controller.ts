import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser, Public, Roles, requireHumanId } from '@codementor/platform';
import { PlanCatalogService } from '../application/plan-catalog.service';
import { SubscriptionsService } from '../application/subscriptions.service';
import { BillingAdminService } from '../application/billing-admin.service';
import {
  AuditQuery,
  AdjustmentDto,
  BillingPage,
  CheckoutDto,
  CouponDto,
  CreatePlanDto,
  DraftVersionDto,
  MockPaymentDto,
  PublishVersionDto,
  QuoteDto,
  ReasonDto,
  RefundDto,
  ScheduleChangeDto,
  SettingsDto,
  SubscriberQuery,
  UpdatePlanDto,
} from './workspace-billing.dto';

/** Workspace plans and billing. Quota enforcement lives in workspace-service. */
@Controller({ path: 'workspace-billing', version: '1' })
export class WorkspaceBillingController {
  constructor(
    private readonly catalog: PlanCatalogService,
    private readonly subscriptions: SubscriptionsService,
    private readonly admin: BillingAdminService,
  ) {}

  // ---------------------------------------------------------------- learners
  @Public() @Get('plans') plans() {
    return this.catalog.onSale();
  }
  @Get('subscription') subscription(@CurrentUser() u: AuthenticatedUser) {
    return this.subscriptions.overview(requireHumanId(u));
  }
  @Post('quote') quote(@CurrentUser() u: AuthenticatedUser, @Body() b: QuoteDto) {
    return this.subscriptions.quote(requireHumanId(u), b);
  }
  @Post('checkout') checkout(@CurrentUser() u: AuthenticatedUser, @Body() b: CheckoutDto) {
    return this.subscriptions.checkout(requireHumanId(u), b);
  }
  @Post('subscription/cancel') cancel(@CurrentUser() u: AuthenticatedUser) {
    return this.subscriptions.cancelRenewal(requireHumanId(u));
  }
  @Post('subscription/resume') resume(@CurrentUser() u: AuthenticatedUser) {
    return this.subscriptions.resumeRenewal(requireHumanId(u));
  }
  @Post('subscription/schedule-change') scheduleChange(@CurrentUser() u: AuthenticatedUser, @Body() b: ScheduleChangeDto) {
    return this.subscriptions.scheduleChange(requireHumanId(u), b);
  }
  @Get('orders') orders(@CurrentUser() u: AuthenticatedUser, @Query() q: BillingPage) {
    return this.subscriptions.orderList(requireHumanId(u), q.page);
  }
  @Get('orders/:id') order(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.order(requireHumanId(u), id);
  }
  @Post('orders/:id/reconcile') async reconcile(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.subscriptions.order(requireHumanId(u), id);
    await this.subscriptions.reconcile(id);
    return this.subscriptions.order(requireHumanId(u), id);
  }
  @Post('orders/:id/mock') mock(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: MockPaymentDto) {
    return this.subscriptions.mock(requireHumanId(u), id, b.result);
  }

  // ----------------------------------------------------------- administrators
  @Get('admin/overview') @Roles('admin') overview() {
    return this.admin.overview();
  }
  @Get('admin/plans') @Roles('admin') adminPlans() {
    return this.catalog.adminList();
  }
  @Post('admin/plans') @Roles('admin') createPlan(@CurrentUser() u: AuthenticatedUser, @Body() b: CreatePlanDto) {
    return this.catalog.createPlan(requireHumanId(u), b);
  }
  @Patch('admin/plans/:id') @Roles('admin') updatePlan(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: UpdatePlanDto,
  ) {
    return this.catalog.updatePlan(requireHumanId(u), id, b);
  }
  @Get('admin/plans/:id/versions') @Roles('admin') versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.versions(id);
  }
  @Put('admin/plans/:id/draft') @Roles('admin') saveDraft(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DraftVersionDto,
  ) {
    return this.catalog.saveDraft(requireHumanId(u), id, b);
  }
  @Delete('admin/plans/:id/draft') @Roles('admin') discardDraft(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.discardDraft(requireHumanId(u), id);
  }
  @Post('admin/plans/:id/publish') @Roles('admin') publish(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: PublishVersionDto,
  ) {
    return this.catalog.publish(requireHumanId(u), id, b);
  }
  @Get('admin/subscribers') @Roles('admin') subscribers(@Query() q: SubscriberQuery) {
    return this.admin.subscribers(q);
  }
  @Get('admin/subscribers/stats') @Roles('admin') subscriberStats() {
    return this.admin.subscriberStats();
  }
  @Get('admin/subscribers/:userId') @Roles('admin') subscriber(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.subscriber(userId);
  }
  @Post('admin/subscribers/:userId/suspend') @Roles('admin') suspend(
    @CurrentUser() u: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() b: ReasonDto,
  ) {
    return this.admin.setSuspended(requireHumanId(u), userId, true, b.reason);
  }
  @Post('admin/subscribers/:userId/restore') @Roles('admin') restore(
    @CurrentUser() u: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() b: ReasonDto,
  ) {
    return this.admin.setSuspended(requireHumanId(u), userId, false, b.reason);
  }
  @Post('admin/subscribers/:userId/adjustments') @Roles('admin') addAdjustment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() b: AdjustmentDto,
  ) {
    return this.admin.addAdjustment(requireHumanId(u), userId, b);
  }
  @Post('admin/adjustments/:id/revoke') @Roles('admin') revokeAdjustment(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ReasonDto,
  ) {
    return this.admin.revokeAdjustment(requireHumanId(u), id, b.reason);
  }
  @Get('admin/orders') @Roles('admin') adminOrders(@Query() q: BillingPage) {
    return this.admin.orders(q);
  }
  @Get('admin/orders/:id') @Roles('admin') adminOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.order(null, id);
  }
  @Post('admin/orders/:id/reconcile') @Roles('admin') async adminReconcile(@Param('id', ParseUUIDPipe) id: string) {
    await this.subscriptions.reconcile(id);
    return this.subscriptions.order(null, id);
  }
  @Post('admin/orders/:id/refund') @Roles('admin') refund(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: RefundDto,
  ) {
    return this.admin.refundOrder(requireHumanId(u), id, b);
  }
  @Get('admin/coupons') @Roles('admin') coupons() {
    return this.admin.coupons();
  }
  @Post('admin/coupons') @Roles('admin') createCoupon(@CurrentUser() u: AuthenticatedUser, @Body() b: CouponDto) {
    return this.admin.createCoupon(requireHumanId(u), b);
  }
  @Post('admin/coupons/:id/deactivate') @Roles('admin') deactivateCoupon(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setCouponActive(requireHumanId(u), id, false);
  }
  @Post('admin/coupons/:id/activate') @Roles('admin') activateCoupon(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setCouponActive(requireHumanId(u), id, true);
  }
  @Get('admin/settings') @Roles('admin') settings() {
    return this.admin.settings();
  }
  @Put('admin/settings') @Roles('admin') updateSettings(@CurrentUser() u: AuthenticatedUser, @Body() b: SettingsDto) {
    return this.admin.updateSettings(requireHumanId(u), b);
  }
  @Get('admin/audit') @Roles('admin') auditLog(@Query() q: AuditQuery) {
    return this.admin.auditLog(q);
  }
}
