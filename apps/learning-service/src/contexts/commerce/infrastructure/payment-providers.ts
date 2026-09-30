import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type {
  PaymentEvidence,
  PaymentInput,
  PaymentProvider,
  ProviderResult,
} from '../domain/money';

type Fields = Record<string, string>;
export function mac(data: string, secret: string, algorithm = 'sha512') {
  return createHmac(algorithm, secret).update(data).digest('hex');
}
export function signedEquals(actual: string, expected: string) {
  return (
    /^[a-f0-9]+$/i.test(actual) &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual.toLowerCase()), Buffer.from(expected))
  );
}
export function vnpCanonical(fields: Fields) {
  return Object.keys(fields)
    .filter((k) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType')
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k]).replace(/%20/g, '+')}`)
    .join('&');
}
export function vietnamDate(date: Date) {
  return new Date(date.getTime() + 7 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}
function momoData(fields: Fields) {
  return Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('&');
}
function strings(value: unknown): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid payment payload');
  const result: Fields = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string' && typeof v !== 'number')
      throw new BadRequestException('Invalid payment field');
    result[k] = String(v);
  }
  return result;
}
function fingerprint(fields: Fields) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.keys(fields)
          .sort()
          .map((k) => [k, fields[k]]),
      ),
    )
    .digest('hex');
}

@Injectable()
export class PaymentProviders {
  get mode(): 'mock' | 'sandbox' {
    return process.env.COMMERCE_MODE === 'sandbox' ? 'sandbox' : 'mock';
  }
  assertEnabled() {
    if (
      process.env.NODE_ENV === 'production' ||
      !['mock', 'sandbox'].includes(process.env.COMMERCE_MODE ?? 'mock')
    ) {
      throw new ServiceUnavailableException(
        'Thương mại thử nghiệm không hoạt động trong production.',
      );
    }
  }
  assertMock() {
    this.assertEnabled();
    if (this.mode !== 'mock') throw new BadRequestException('Chỉ dành cho mock');
  }
  methods(): PaymentProvider[] {
    if (
      process.env.NODE_ENV === 'production' ||
      !['mock', 'sandbox'].includes(process.env.COMMERCE_MODE ?? 'mock')
    )
      return [];
    if (this.mode === 'mock') return ['mock'];
    const methods: PaymentProvider[] = [];
    if (
      process.env.VNPAY_TMN_CODE &&
      process.env.VNPAY_HASH_SECRET &&
      process.env.COMMERCE_PUBLIC_API_URL
    )
      methods.push('vnpay');
    if (
      process.env.MOMO_PARTNER_CODE &&
      process.env.MOMO_ACCESS_KEY &&
      process.env.MOMO_SECRET_KEY &&
      process.env.COMMERCE_PUBLIC_API_URL
    )
      methods.push('momo');
    return methods;
  }
  private ensure(provider: PaymentProvider) {
    this.assertEnabled();
    if (!this.methods().includes(provider))
      throw new BadRequestException('Phương thức chưa được cấu hình.');
  }
  private returnUrl(orderId: string) {
    return `${(process.env.COMMERCE_CLIENT_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/purchases/${orderId}`;
  }
  async create(provider: PaymentProvider, p: PaymentInput): Promise<string> {
    this.ensure(provider);
    if (provider === 'mock') return this.returnUrl(p.orderId);
    if (provider === 'vnpay') {
      const fields: Fields = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: process.env.VNPAY_TMN_CODE!,
        vnp_Amount: String(p.amount * 100),
        vnp_CurrCode: 'VND',
        vnp_TxnRef: p.id,
        vnp_OrderInfo: `CodeMentor ${p.orderId}`,
        vnp_OrderType: 'other',
        vnp_Locale: 'vn',
        vnp_ReturnUrl: this.returnUrl(p.orderId),
        vnp_CreateDate: vietnamDate(p.createdAt),
        vnp_ExpireDate: vietnamDate(p.expiresAt),
        vnp_IpAddr: '127.0.0.1',
      };
      const data = vnpCanonical(fields);
      return `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?${data}&vnp_SecureHash=${mac(data, process.env.VNPAY_HASH_SECRET!)}`;
    }
    const body = {
      partnerCode: process.env.MOMO_PARTNER_CODE!,
      requestId: p.id,
      orderId: p.id,
      amount: p.amount,
      orderInfo: `CodeMentor ${p.orderId}`,
      redirectUrl: this.returnUrl(p.orderId),
      ipnUrl: `${process.env.COMMERCE_PUBLIC_API_URL!.replace(/\/$/, '')}/commerce/webhooks/momo`,
      extraData: '',
      requestType: 'captureWallet',
      lang: 'vi',
      autoCapture: true,
    };
    const signing: Fields = {
      accessKey: process.env.MOMO_ACCESS_KEY!,
      amount: String(body.amount),
      extraData: '',
      ipnUrl: body.ipnUrl,
      orderId: p.id,
      orderInfo: body.orderInfo,
      partnerCode: body.partnerCode,
      redirectUrl: body.redirectUrl,
      requestId: p.id,
      requestType: body.requestType,
    };
    const result = await this.post('https://test-payment.momo.vn/v2/gateway/api/create', {
      ...body,
      signature: mac(momoData(signing), process.env.MOMO_SECRET_KEY!, 'sha256'),
    });
    if (
      String(result.orderId) !== p.id ||
      String(result.requestId) !== p.id ||
      Number(result.amount) !== p.amount ||
      result.partnerCode !== body.partnerCode ||
      Number(result.resultCode) !== 0 ||
      typeof result.payUrl !== 'string'
    )
      throw new Error('MoMo create rejected');
    const url = new URL(result.payUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'test-payment.momo.vn')
      throw new Error('Unexpected sandbox payment URL');
    return result.payUrl;
  }
  verify(provider: 'vnpay' | 'momo', value: unknown): PaymentEvidence {
    this.ensure(provider);
    const f = strings(value);
    const paymentId = provider === 'vnpay' ? f.vnp_TxnRef : f.orderId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId ?? ''))
      throw new BadRequestException('Mã thanh toán không hợp lệ');
    if (provider === 'vnpay') {
      if (
        !signedEquals(
          f.vnp_SecureHash ?? '',
          mac(vnpCanonical(f), process.env.VNPAY_HASH_SECRET!),
        ) ||
        f.vnp_TmnCode !== process.env.VNPAY_TMN_CODE
      )
        throw new BadRequestException('Chữ ký hoặc merchant không hợp lệ');
      if (!/^\d+$/.test(f.vnp_Amount) || Number(f.vnp_Amount) % 100 !== 0)
        throw new BadRequestException('Số tiền không hợp lệ');
      return {
        paymentId: f.vnp_TxnRef,
        amount: Number(f.vnp_Amount) / 100,
        reference: f.vnp_TransactionNo,
        result:
          f.vnp_ResponseCode === '00' && f.vnp_TransactionStatus === '00'
            ? 'success'
            : f.vnp_ResponseCode === '24'
              ? 'cancelled'
              : f.vnp_TransactionStatus === '02'
                ? 'failure'
                : 'pending',
        fingerprint: fingerprint(f),
      };
    }
    const keys = [
      'amount',
      'extraData',
      'message',
      'orderId',
      'orderInfo',
      'orderType',
      'partnerCode',
      'payType',
      'requestId',
      'responseTime',
      'resultCode',
      'transId',
    ];
    const data: Fields = { accessKey: process.env.MOMO_ACCESS_KEY! };
    keys.forEach((k) => {
      data[k] = f[k] ?? '';
    });
    if (
      !signedEquals(
        f.signature ?? '',
        mac(momoData(data), process.env.MOMO_SECRET_KEY!, 'sha256'),
      ) ||
      f.partnerCode !== process.env.MOMO_PARTNER_CODE ||
      f.requestId !== f.orderId
    )
      throw new BadRequestException('Chữ ký hoặc merchant không hợp lệ');
    return {
      paymentId: f.orderId,
      amount: Number(f.amount),
      reference: f.transId,
      result: this.momoResult(Number(f.resultCode)),
      fingerprint: fingerprint(f),
    };
  }
  private momoResult(code: number): ProviderResult {
    if (code === 0) return 'success';
    if (code === 1006) return 'cancelled';
    if ([1001, 1002, 1003, 1005, 1007].includes(code)) return 'failure';
    return 'pending';
  }
  async query(
    provider: PaymentProvider,
    p: PaymentInput,
    refund = false,
  ): Promise<PaymentEvidence | null> {
    this.ensure(provider);
    if (provider === 'mock') return null;
    if (provider === 'momo') {
      const requestId = randomUUID();
      const fields = {
        accessKey: process.env.MOMO_ACCESS_KEY!,
        orderId: p.id,
        partnerCode: process.env.MOMO_PARTNER_CODE!,
        requestId,
      };
      const r = await this.post('https://test-payment.momo.vn/v2/gateway/api/query', {
        partnerCode: fields.partnerCode,
        orderId: p.id,
        requestId,
        lang: 'vi',
        signature: mac(momoData(fields), process.env.MOMO_SECRET_KEY!, 'sha256'),
      });
      if (
        r.partnerCode !== fields.partnerCode ||
        r.orderId !== p.id ||
        r.requestId !== requestId ||
        Number(r.amount) !== p.amount
      )
        throw new Error('MoMo query identity mismatch');
      return {
        paymentId: p.id,
        amount: p.amount,
        reference: String(r.transId ?? ''),
        result: this.momoResult(Number(r.resultCode)),
        fingerprint: fingerprint(
          strings(
            Object.fromEntries(
              Object.entries(r).filter(([, v]) => typeof v === 'number' || typeof v === 'string'),
            ),
          ),
        ),
      };
    }
    const f: Fields = {
      vnp_RequestId: randomUUID().replace(/-/g, ''),
      vnp_Version: '2.1.0',
      vnp_Command: 'querydr',
      vnp_TmnCode: process.env.VNPAY_TMN_CODE!,
      vnp_TxnRef: p.id,
      vnp_OrderInfo: `Query ${p.id}`,
      vnp_TransactionDate: vietnamDate(p.createdAt),
      vnp_CreateDate: vietnamDate(new Date()),
      vnp_IpAddr: '127.0.0.1',
    };
    const raw = [
      'vnp_RequestId',
      'vnp_Version',
      'vnp_Command',
      'vnp_TmnCode',
      'vnp_TxnRef',
      'vnp_TransactionDate',
      'vnp_CreateDate',
      'vnp_IpAddr',
      'vnp_OrderInfo',
    ]
      .map((k) => f[k])
      .join('|');
    const r = strings(
      await this.post('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction', {
        ...f,
        vnp_SecureHash: mac(raw, process.env.VNPAY_HASH_SECRET!),
      }),
    );
    const keys = [
      'vnp_ResponseId',
      'vnp_Command',
      'vnp_ResponseCode',
      'vnp_Message',
      'vnp_TmnCode',
      'vnp_TxnRef',
      'vnp_Amount',
      'vnp_BankCode',
      'vnp_PayDate',
      'vnp_TransactionNo',
      'vnp_TransactionType',
      'vnp_TransactionStatus',
      'vnp_OrderInfo',
      'vnp_PromotionCode',
      'vnp_PromotionAmount',
    ];
    if (
      !signedEquals(
        r.vnp_SecureHash ?? '',
        mac(keys.map((k) => r[k] ?? '').join('|'), process.env.VNPAY_HASH_SECRET!),
      ) ||
      r.vnp_TmnCode !== f.vnp_TmnCode ||
      r.vnp_TxnRef !== p.id ||
      r.vnp_Command !== 'querydr'
    )
      throw new Error('VNPAY query signature/identity mismatch');
    if (r.vnp_ResponseCode !== '00' || r.vnp_TransactionType !== (refund ? '02' : '01'))
      return null;
    return {
      paymentId: p.id,
      amount: Number(r.vnp_Amount) / 100,
      reference: r.vnp_TransactionNo,
      result:
        r.vnp_TransactionStatus === '00'
          ? 'success'
          : r.vnp_TransactionStatus === (refund ? '09' : '02')
            ? 'failure'
            : 'pending',
      fingerprint: fingerprint(r),
    };
  }
  async queryRefund(
    provider: PaymentProvider,
    p: PaymentInput,
    refundId: string,
  ): Promise<ProviderResult> {
    this.ensure(provider);
    if (provider === 'mock') return 'unknown';
    if (provider === 'vnpay') {
      const evidence = await this.query(provider, p, true);
      if (evidence && evidence.amount !== p.amount) throw new Error('Refund amount mismatch');
      return evidence?.result ?? 'unknown';
    }
    const f = {
      accessKey: process.env.MOMO_ACCESS_KEY!,
      orderId: refundId,
      partnerCode: process.env.MOMO_PARTNER_CODE!,
      requestId: randomUUID(),
    };
    const r = await this.post('https://test-payment.momo.vn/v2/gateway/api/refund/query', {
      partnerCode: f.partnerCode,
      orderId: refundId,
      requestId: f.requestId,
      lang: 'vi',
      signature: mac(momoData(f), process.env.MOMO_SECRET_KEY!, 'sha256'),
    });
    if (r.partnerCode !== f.partnerCode || r.orderId !== refundId || r.requestId !== f.requestId)
      throw new Error('Refund query identity mismatch');
    if (Number(r.resultCode) !== 0 || !Array.isArray(r.refundTrans)) return 'unknown';
    const match = r.refundTrans.filter((row: Record<string, unknown>) => row.orderId === refundId);
    if (match.length !== 1 || Number(match[0].amount) !== p.amount) return 'unknown';
    return Number(match[0].resultCode) === 0 ? 'success' : 'unknown';
  }
  async refund(
    provider: PaymentProvider,
    p: PaymentInput,
    refundId: string,
    reference: string,
  ): Promise<ProviderResult> {
    this.ensure(provider);
    if (provider === 'mock') return 'success';
    if (process.env.COMMERCE_SANDBOX_REFUNDS !== 'true')
      throw new BadRequestException('Chưa bật quyền hoàn tiền sandbox của đối tác.');
    if (provider === 'momo') {
      const f = {
        accessKey: process.env.MOMO_ACCESS_KEY!,
        amount: String(p.amount),
        description: `Refund ${p.orderId}`,
        orderId: refundId,
        partnerCode: process.env.MOMO_PARTNER_CODE!,
        requestId: refundId,
        transId: reference,
      };
      const r = await this.post('https://test-payment.momo.vn/v2/gateway/api/refund', {
        partnerCode: f.partnerCode,
        orderId: refundId,
        requestId: refundId,
        transId: Number(reference),
        amount: p.amount,
        description: f.description,
        lang: 'vi',
        signature: mac(momoData(f), process.env.MOMO_SECRET_KEY!, 'sha256'),
      });
      if (
        r.partnerCode !== f.partnerCode ||
        r.orderId !== refundId ||
        r.requestId !== refundId ||
        Number(r.amount) !== p.amount
      )
        throw new Error('Refund identity mismatch');
      return Number(r.resultCode) === 0 ? 'success' : 'unknown';
    }
    const f: Fields = {
      vnp_RequestId: refundId.replace(/-/g, ''),
      vnp_Version: '2.1.0',
      vnp_Command: 'refund',
      vnp_TmnCode: process.env.VNPAY_TMN_CODE!,
      vnp_TransactionType: '02',
      vnp_TxnRef: p.id,
      vnp_Amount: String(p.amount * 100),
      vnp_TransactionNo: reference,
      vnp_TransactionDate: vietnamDate(p.createdAt),
      vnp_CreateBy: 'CodeMentorAdmin',
      vnp_CreateDate: vietnamDate(new Date()),
      vnp_IpAddr: '127.0.0.1',
      vnp_OrderInfo: `Refund ${p.orderId}`,
    };
    const raw = Object.values(f).join('|');
    const r = strings(
      await this.post('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction', {
        ...f,
        vnp_SecureHash: mac(raw, process.env.VNPAY_HASH_SECRET!),
      }),
    );
    const keys = [
      'vnp_ResponseId',
      'vnp_Command',
      'vnp_ResponseCode',
      'vnp_Message',
      'vnp_TmnCode',
      'vnp_TxnRef',
      'vnp_Amount',
      'vnp_BankCode',
      'vnp_PayDate',
      'vnp_TransactionNo',
      'vnp_TransactionType',
      'vnp_TransactionStatus',
      'vnp_OrderInfo',
    ];
    if (
      !signedEquals(
        r.vnp_SecureHash ?? '',
        mac(keys.map((k) => r[k] ?? '').join('|'), process.env.VNPAY_HASH_SECRET!),
      ) ||
      r.vnp_TxnRef !== p.id ||
      r.vnp_TmnCode !== f.vnp_TmnCode ||
      Number(r.vnp_Amount) !== p.amount * 100 ||
      r.vnp_Command !== 'refund'
    )
      throw new Error('Refund signature/identity mismatch');
    return r.vnp_ResponseCode === '00' &&
      r.vnp_TransactionStatus === '00' &&
      r.vnp_TransactionType === '02'
      ? 'success'
      : 'unknown';
  }
  private async post(url: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Sandbox provider HTTP ${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
}
