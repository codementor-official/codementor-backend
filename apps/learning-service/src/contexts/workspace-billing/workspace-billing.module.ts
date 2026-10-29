import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { PlanCatalogService } from './application/plan-catalog.service';
import { SubscriptionsService } from './application/subscriptions.service';
import { BillingAdminService } from './application/billing-admin.service';
import { WorkspaceBillingController } from './presentation/workspace-billing.controller';

/** Workspace plans, subscriptions and their payments. Shares payment rails with course commerce. */
@Module({
  imports: [CommerceModule],
  controllers: [WorkspaceBillingController],
  providers: [PlanCatalogService, SubscriptionsService, BillingAdminService],
})
export class WorkspaceBillingModule {}
