import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PaymentProviders } from '../infrastructure/payment-providers';
import type { OrdersService } from '../application/orders.service';

export async function confirmVnpayIpn(
  providers: Pick<PaymentProviders, 'verify'>,
  orders: Pick<OrdersService, 'apply'>,
  query: Record<string, string>,
) {
  let evidence;
  try {
    evidence = providers.verify('vnpay', query);
  } catch (error) {
    if (!(error instanceof BadRequestException))
      return { RspCode: '99', Message: 'Confirmation unavailable' };
    const code = error.message.includes('Mã thanh toán') ? '01'
      : error.message.includes('Số tiền') ? '04' : '97';
    return { RspCode: code, Message: 'Invalid order, amount or signature' };
  }
  try {
    const result = await orders.apply('vnpay', evidence) as unknown as
      { quarantined?: boolean; duplicate?: boolean } | undefined;
    return { RspCode: result?.quarantined ? '99' : result?.duplicate ? '02' : '00',
      Message: result?.quarantined ? 'Review required' : 'Confirmed' };
  } catch (error) {
    return { RspCode: error instanceof NotFoundException ? '01'
      : error instanceof BadRequestException ? '04' : '99', Message: 'Confirmation failed' };
  }
}
