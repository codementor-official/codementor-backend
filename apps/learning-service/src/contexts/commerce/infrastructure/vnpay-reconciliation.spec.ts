import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { PaymentProviders, mac, vnpPaymentDate } from './payment-providers';
import { requiresPaymentReview } from '../domain/money';
import { acquireVnpayQueryLease } from './vnpay-query-throttle';
import type { CommerceStore } from './commerce.store';
import { confirmVnpayIpn } from '../presentation/vnpay-ipn';
jest.mock('@codementor/platform', () => ({ PrismaService: class {} }));

describe('VNPAY reconciliation and IPN', () => {
  const original = { ...process.env };
  const payment = { id: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222', amount: 10000,
    createdAt: new Date('2026-10-06T13:04:52Z'), expiresAt: new Date() };
  beforeEach(() => {
    process.env.COMMERCE_MODE = 'sandbox';
    process.env.COMMERCE_ENABLED = 'true';
    process.env.COMMERCE_PUBLIC_API_URL = 'https://example.test/api/v1';
    process.env.VNPAY_TMN_CODE = 'UNITTEST';
    process.env.VNPAY_HASH_SECRET = 'unit-test-signing-key';
  });
  afterEach(() => { process.env = { ...original }; jest.restoreAllMocks(); });
  const responseKeys = ['vnp_ResponseId','vnp_Command','vnp_ResponseCode','vnp_Message',
    'vnp_TmnCode','vnp_TxnRef','vnp_Amount','vnp_BankCode','vnp_PayDate',
    'vnp_TransactionNo','vnp_TransactionType','vnp_TransactionStatus','vnp_OrderInfo',
    'vnp_PromotionCode','vnp_PromotionAmount'];
  function signedResponse(overrides: Record<string,string> = {}) {
    const r = { vnp_ResponseId: 'response1', vnp_Command: 'querydr', vnp_ResponseCode: '00',
      vnp_Message: 'OK', vnp_TmnCode: 'UNITTEST', vnp_TxnRef: payment.id, vnp_Amount: '1000000',
      vnp_BankCode: 'NCB', vnp_TransactionNo: '123456', vnp_TransactionType: '01',
      vnp_TransactionStatus: '00', vnp_OrderInfo: 'CodeMentor', ...overrides } as Record<string,string>;
    return { ...r, vnp_SecureHash: mac(responseKeys.map(k=>r[k]??'').join('|'), process.env.VNPAY_HASH_SECRET!) };
  }
  function fetchResult(r: unknown) {
    return jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(r), { status: 200 }));
  }
  it('accepts signed success with matching payment identity', async () => {
    fetchResult(signedResponse());
    await expect(new PaymentProviders().query('vnpay',payment)).resolves.toMatchObject({result:'success',amount:10000});
  });
  it.each(['94','91','97','99'])('handles unsigned diagnostic %s without settlement evidence', async code => {
    fetchResult({vnp_ResponseCode:code,vnp_Message:'diagnostic'});
    try { await new PaymentProviders().query('vnpay',payment); throw new Error('Expected rejection'); }
    catch(error) { expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(code==='94'?429:503); }
  });
  it.each(['signature','reference','merchant'])('rejects invalid success %s', async kind => {
    const r = signedResponse(kind==='reference'?{vnp_TxnRef:payment.orderId}:kind==='merchant'?{vnp_TmnCode:'OTHER'}:{});
    fetchResult(kind==='signature'?{...r,vnp_SecureHash:'invalid'}:r);
    await expect(new PaymentProviders().query('vnpay',payment)).rejects.toThrow();
  });
  it('uses original payment creation date and never sends merchant secrets', async () => {
    const request = fetchResult(signedResponse());
    await new PaymentProviders().query('vnpay',payment);
    const body=JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.vnp_TransactionDate).toBe('20261006200452');
    expect(body.vnp_TxnRef).toBe(payment.id);
    expect(JSON.stringify(body)).not.toContain(process.env.VNPAY_HASH_SECRET);
  });
  it('durably permits only one simultaneous query and supplies retry duration', async () => {
    let claimed=false;
    const db={$queryRaw:jest.fn(async (sql:TemplateStringsArray)=>{
      if(sql.join('').includes('INSERT')) { if(claimed)return [];claimed=true;return [{payment_id:payment.id}]; }
      return [{seconds:359}];
    })} as unknown as CommerceStore['db'];
    const r=await Promise.allSettled([acquireVnpayQueryLease(db,payment.id),acquireVnpayQueryLease(db,payment.id)]);
    expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    const failure=r.find(x=>x.status==='rejected') as PromiseRejectedResult;
    expect(failure.reason.getResponse()).toMatchObject({code:'VNPAY_QUERY_COOLDOWN',retryAfterSeconds:359});
  });
  it('distinguishes a delayed confirmation from a genuinely late payment', () => {
    const order={created_at:new Date('2026-10-06T13:04:52Z'),expires_at:new Date('2026-10-06T13:24:52Z'),status:'expired'};
    const timely={paidAt:vnpPaymentDate('20261006201000')};
    const now=new Date('2026-10-06T13:40:00Z').getTime();
    expect(requiresPaymentReview(order,false,timely,now)).toBe(false);
    expect(requiresPaymentReview(order,false,{paidAt:vnpPaymentDate('20261006203000')},now)).toBe(true);
    expect(requiresPaymentReview(order,true,timely,now)).toBe(true);
    expect(requiresPaymentReview({...order,status:'cancelled'},false,timely,now)).toBe(true);
    expect(requiresPaymentReview(order,false,{},now)).toBe(true);
    expect(requiresPaymentReview(order,false,{paidAt:new Date('2026-10-06T12:00:00Z')},now)).toBe(true);
  });
  it('rejects malformed authenticated payment dates rather than normalizing them', () => {
    expect(()=>vnpPaymentDate('20260230201000')).toThrow();
    expect(()=>vnpPaymentDate('invalid')).toThrow();
    expect(vnpPaymentDate(undefined)).toBeUndefined();
  });
  it.each([
    [new BadRequestException('Chữ ký hoặc merchant không hợp lệ'),'97'],
    [new BadRequestException('Mã thanh toán không hợp lệ'),'01'],
    [new BadRequestException('Số tiền không hợp lệ'),'04'],
  ])('rejects invalid IPN without applying financial effects',async(error,code)=>{
    const orders={apply:jest.fn()};
    const result=await confirmVnpayIpn({verify:jest.fn(()=>{throw error;})},orders,{});
    expect(result.RspCode).toBe(code);expect(orders.apply).not.toHaveBeenCalled();
  });
  it('returns order-not-found, duplicate and temporary failure protocol codes',async()=>{
    const providers={verify:jest.fn(()=>({paymentId:payment.id,amount:10000,result:'success' as const,reference:'123',fingerprint:'hash'}))};
    for(const [reply,code] of [[new NotFoundException(),'01'],[{duplicate:true},'02'],[new Error('db unavailable'),'99']] as const){
      const apply=jest.fn(async()=>{if(reply instanceof Error)throw reply;return reply;});
      expect((await confirmVnpayIpn(providers,{apply} as never,{})).RspCode).toBe(code);
    }
  });
});
