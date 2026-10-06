import { randomUUID } from 'node:crypto';
import { PaymentProviders, mac, vnpCanonical, signedEquals } from './payment-providers';
jest.mock('@codementor/platform', () => ({ PrismaService: class {} }));

describe('Payment provider evidence verification', () => {
  const previous = { ...process.env };
  const providers = new PaymentProviders();
  const id = randomUUID();
  const p = { id, orderId: randomUUID(), amount: 200000, createdAt: new Date(), expiresAt: new Date(Date.now() + 600000) };
  const signing = (fields: Record<string, string | number>) => Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('&');
  beforeEach(() => {
    process.env.COMMERCE_MODE = 'sandbox';
    process.env.COMMERCE_ENABLED = 'true';
    process.env.COMMERCE_PUBLIC_API_URL = 'https://example.test/api/v1';
    process.env.VNPAY_TMN_CODE = 'TEST';
    process.env.VNPAY_HASH_SECRET = 'unit-test-only-vnp';
    process.env.MOMO_PARTNER_CODE = 'TEST';
    process.env.MOMO_ACCESS_KEY = 'unit-test-access';
    process.env.MOMO_SECRET_KEY = 'unit-test-only-momo';
  });
  afterEach(() => { process.env = { ...previous }; jest.restoreAllMocks(); });
  function vnp(amount = '20000000') {
    const data = { vnp_TmnCode: 'TEST', vnp_TxnRef: id, vnp_Amount: amount, vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '123', vnp_CurrCode: 'VND' };
    return { ...data, vnp_SecureHash: mac(vnpCanonical(data), process.env.VNPAY_HASH_SECRET!) };
  }
  function momo(amount: string | number = 200000) {
    const data = { amount, extraData: '', message: 'OK', orderId: id, orderInfo: 'CodeMentor', orderType: 'momo_wallet', partnerCode: 'TEST', payType: 'qr', requestId: id, responseTime: 1, resultCode: 0, transId: '123' };
    return { ...data, signature: mac(signing({ ...data, accessKey: process.env.MOMO_ACCESS_KEY! }), process.env.MOMO_SECRET_KEY!, 'sha256') };
  }
  it('accepts authenticated VNPAY success with exact VND scaling', () => {
    expect(providers.verify('vnpay', vnp())).toMatchObject({ paymentId: id, amount: 200000, result: 'success', reference: '123' });
  });
  it('rejects tampering, merchant changes and fractional VND in signed VNPAY data', () => {
    expect(() => providers.verify('vnpay', { ...vnp(), vnp_Amount: '100000' })).toThrow();
    expect(() => providers.verify('vnpay', { ...vnp(), vnp_TmnCode: 'OTHER' })).toThrow();
    expect(() => providers.verify('vnpay', vnp('20000001'))).toThrow();
    expect(() => providers.verify('vnpay', vnp('9007199254740992'))).toThrow();
  });
  it('accepts authenticated MoMo success and rejects tampering or mismatched request IDs', () => {
    expect(providers.verify('momo', momo())).toMatchObject({ paymentId: id, amount: 200000, result: 'success' });
    expect(providers.verify('momo', { ...momo(), promotionInfo: [] }).result).toBe('success');
    expect(() => providers.verify('momo', { ...momo(), amount: 1000 })).toThrow();
    expect(() => providers.verify('momo', { ...momo(), requestId: randomUUID() })).toThrow();
    expect(() => providers.verify('momo', momo('200000.5'))).toThrow();
  });
  it('compares signatures safely without accepting malformed or truncated values', () => {
    expect(signedEquals('ff', 'ffff')).toBe(false);
    expect(signedEquals('zz', 'ff')).toBe(false);
    expect(signedEquals('FF', 'ff')).toBe(true);
  });
  it.each(['identity', 'amount', 'reference'] as const)('rejects MoMo query %s mismatches', async (kind) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { requestId: string };
      const response = { partnerCode: 'TEST', orderId: kind === 'identity' ? randomUUID() : id, requestId: request.requestId,
        amount: kind === 'amount' ? 1 : 200000, transId: kind === 'reference' ? Number.MAX_SAFE_INTEGER + 1 : 123, resultCode: 0 };
      return new Response(JSON.stringify(response), { status: 200 });
    });
    await expect(providers.query('momo', p)).rejects.toThrow();
  });
  it('does not fabricate success when provider request times out', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    await expect(providers.query('momo', p)).rejects.toThrow();
  });
  it('rejects unsigned MoMo checkout responses and accepts properly signed responses', async () => {
    const result = { orderId: id, requestId: id, partnerCode: 'TEST', amount: 200000, payUrl: 'https://test-payment.momo.vn/pay/test', responseTime: 1, resultCode: 0 };
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }));
    await expect(providers.create('momo', p)).rejects.toThrow('signature');
    const signature = mac(signing({ ...result, accessKey: process.env.MOMO_ACCESS_KEY! }), process.env.MOMO_SECRET_KEY!, 'sha256');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ ...result, signature }), { status: 200 }));
    await expect(providers.create('momo', p)).resolves.toBe(result.payUrl);
  });
});
