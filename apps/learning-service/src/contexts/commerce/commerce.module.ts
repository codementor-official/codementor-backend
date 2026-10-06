import { Module } from '@nestjs/common';
import { CommerceStore } from './infrastructure/commerce.store';
import { PaymentProviders } from './infrastructure/payment-providers';
import { CommerceAccessService } from './application/commerce-access.service';
import { OrdersService } from './application/orders.service';
import { MockPayoutAdapter, WalletService } from './application/wallet.service';
import { CommerceJobs } from './application/commerce.jobs';
import { CommerceController } from './presentation/commerce.controller';
import { RevenueAnalyticsService } from './application/revenue-analytics.service';
@Module({
  controllers: [CommerceController],
  providers: [
    RevenueAnalyticsService,
    CommerceStore,
    PaymentProviders,
    CommerceAccessService,
    OrdersService,
    MockPayoutAdapter,
    WalletService,
    CommerceJobs,
  ],
  exports: [CommerceAccessService],
})
export class CommerceModule {}
