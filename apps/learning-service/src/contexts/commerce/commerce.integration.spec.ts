import { randomUUID } from 'node:crypto';
import { PrismaService } from '@codementor/platform';
import type { AuthenticatedUser } from '@codementor/platform';
import { CommerceStore } from './infrastructure/commerce.store';
import { PaymentProviders, mac, vnpCanonical } from './infrastructure/payment-providers';
import { OrdersService } from './application/orders.service';
import { WalletService, MockPayoutAdapter } from './application/wallet.service';
import { CommerceAccessService } from './application/commerce-access.service';
import { splitRevenue } from './domain/money';
import { Module, ValidationPipe, VersioningType, UnauthorizedException } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { CommerceController } from './presentation/commerce.controller';
import { CommerceJobs } from './application/commerce.jobs';
import { RolesGuard } from '../../../../../libs/platform/src/auth/roles.guard';
import { ResponseInterceptor } from '../../../../../libs/platform/src/http/interceptors/response.interceptor';
jest.mock('jwks-rsa', () => ({ passportJwtSecret: jest.fn() }));

// Explicit opt-in, isolated local database only. Never falls back to DATABASE_URL/.env.
const url = process.env.COMMERCE_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    new URL(url).pathname !== '/commerce_test')
)
  throw new Error('Commerce tests require an isolated local commerce_test database');
const integration = url ? describe : describe.skip;
integration('Commerce transactions (real PostgreSQL)', () => {
  const db = new PrismaService({ datasourceUrl: url! });
  const store = new CommerceStore(db);
  const providers = new PaymentProviders();
  const orders = new OrdersService(store, providers);
  const wallet = new WalletService(store, providers, new MockPayoutAdapter());
  const access = new CommerceAccessService(store);
  let instructor: string;
  let admin: string;
  async function user(role = 'learner') {
    const id = randomUUID();
    await db.$executeRaw`INSERT INTO users(id,email,display_name,role) VALUES (${id}::uuid,${`${id}@test.invalid`},'Commerce test',${role}::platform_role)`;
    return id;
  }
  function actor(id: string, role: AuthenticatedUser['role'] = 'lecturer'): AuthenticatedUser {
    return {
      id,
      externalId: id,
      email: 'test@test.invalid',
      displayName: 'Test',
      role,
      actorType: 'human',
    };
  }
  async function course(price = 200000) {
    const id = randomUUID();
    await db.$executeRaw`INSERT INTO courses(id,slug,title,level,status,created_by,published_at) VALUES (${id}::uuid,${id},'Commerce test','basic','published',${instructor}::uuid,now())`;
    await db.$executeRaw`INSERT INTO course_prices(course_id,price_vnd) VALUES (${id}::uuid,${price})`;
    return id;
  }
  async function purchase() {
    const buyer = await user();
    const id = await course();
    const order = await orders.create(buyer, id, 'mock');
    await orders.mock(buyer, order.id, 'success');
    return { buyer, courseId: id, order };
  }
  function recipient(label: string, testReference: string) {
    return {
      method: 'bank' as const,
      institutionCode: 'VCB',
      accountName: 'COMMERCE TEST',
      accountNumber: '0123456789',
      label,
      testReference,
    };
  }
  async function release(id: string) {
    await db.$executeRaw`UPDATE commerce_orders SET available_at=now()-interval '1 second' WHERE id=${id}::uuid`;
    await wallet.releaseIncome(id);
  }
  async function cleanupFixtures() {
    await db.$transaction(async (tx) => {
      // Posted ledgers are immutable in the application. Integration fixtures still need
      // to be removed so a test run never leaks dozens of "Commerce test" courses into
      // the local catalogue; disabling these triggers is restricted to this guarded DB.
      await tx.$executeRawUnsafe('ALTER TABLE commerce_entries DISABLE TRIGGER USER');
      await tx.$executeRawUnsafe('ALTER TABLE commerce_journals DISABLE TRIGGER USER');
      await tx.$executeRawUnsafe('ALTER TABLE commerce_audit DISABLE TRIGGER USER');
      await tx.$executeRawUnsafe(`DELETE FROM commerce_provider_events WHERE payment_id IN (
        SELECT p.id FROM commerce_payments p JOIN commerce_orders o ON o.id=p.order_id
        WHERE o.buyer_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
          OR o.instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_entries WHERE owner_id IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
        OR journal_id IN (SELECT j.id FROM commerce_journals j
          LEFT JOIN commerce_orders o ON o.id=j.order_id
          LEFT JOIN commerce_withdrawals w ON w.id=j.withdrawal_id
          LEFT JOIN commerce_refunds r ON r.id=j.refund_id
          WHERE o.buyer_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
             OR o.instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
             OR w.instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
             OR r.requested_by IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_journals WHERE order_id IN (
          SELECT id FROM commerce_orders WHERE buyer_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
            OR instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))
        OR withdrawal_id IN (SELECT id FROM commerce_withdrawals WHERE instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))
        OR refund_id IN (SELECT id FROM commerce_refunds WHERE requested_by IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_refunds WHERE requested_by IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
        OR order_id IN (SELECT id FROM commerce_orders WHERE buyer_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
          OR instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_payments WHERE order_id IN (
        SELECT id FROM commerce_orders WHERE buyer_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
          OR instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))`);
      await tx.$executeRawUnsafe(`DELETE FROM course_access_grants WHERE user_id IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
        OR course_id IN (SELECT id FROM courses WHERE created_by IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_orders WHERE buyer_id IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
        OR instructor_id IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid')`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_audit WHERE actor_id IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_withdrawals WHERE instructor_id IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')`);
      await tx.$executeRawUnsafe(`DELETE FROM commerce_recipients WHERE user_id IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')`);
      await tx.$executeRawUnsafe(`DELETE FROM course_enrollments WHERE user_id IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')
        OR course_id IN (SELECT id FROM courses WHERE created_by IN (SELECT id FROM users WHERE email::text LIKE '%@test.invalid'))`);
      await tx.$executeRawUnsafe(`DELETE FROM courses WHERE created_by IN (
        SELECT id FROM users WHERE email::text LIKE '%@test.invalid')`);
      await tx.$executeRawUnsafe(`DELETE FROM users WHERE email::text LIKE '%@test.invalid'`);
      await tx.$executeRawUnsafe('ALTER TABLE commerce_entries ENABLE TRIGGER USER');
      await tx.$executeRawUnsafe('ALTER TABLE commerce_journals ENABLE TRIGGER USER');
      await tx.$executeRawUnsafe('ALTER TABLE commerce_audit ENABLE TRIGGER USER');
    });
  }
  beforeAll(async () => {
    process.env.COMMERCE_MODE = 'mock';
    await db.$connect();
    admin = await user('admin');
  }, 20000);
  beforeEach(async () => {
    instructor = await user('lecturer');
    await db.$executeRaw`UPDATE commerce_policy SET instructor_bps=8000,hold_days=7,minimum_withdrawal=100000,approval_required=true`;
  });
  afterAll(async () => {
    await cleanupFixtures();
    await db.$disconnect();
  }, 20000);
  it('HTTP E2E: authorization, purchase, payout, refund and validation', async () => {
    const buyer = await user();
    const c = await course();
    // Only the identity boundary is stubbed; the real RolesGuard, validation, controller,
    // transaction services and PostgreSQL run. This test module is never in an app module.
    const identities = new Map([
      ['buyer', actor(buyer, 'learner')],
      ['lecturer', actor(instructor)],
      ['admin', actor(admin, 'admin')],
    ]);
    const jobs = new CommerceJobs(store, orders, wallet);
    class Harness {}
    Module({
      controllers: [CommerceController],
      providers: [
        { provide: CommerceStore, useValue: store },
        { provide: OrdersService, useValue: orders },
        { provide: WalletService, useValue: wallet },
        { provide: CommerceAccessService, useValue: access },
        { provide: PaymentProviders, useValue: providers },
        { provide: CommerceJobs, useValue: jobs },
      ],
    })(Harness);
    const app = await NestFactory.create<NestFastifyApplication>(Harness, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalGuards(
      {
        canActivate(ctx) {
          const req = ctx.switchToHttp().getRequest();
          const identity = identities.get(req.headers.authorization);
          if (!identity) throw new UnauthorizedException();
          req.user = identity;
          return true;
        },
      },
      new RolesGuard(new Reflector()),
    );
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const call = (
      who: string,
      method: 'GET' | 'POST' | 'PUT',
      path: string,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method,
        url: '/api/v1/commerce/' + path,
        headers: { authorization: who },
        payload,
      });
    try {
      expect((await call('', 'GET', 'orders')).statusCode).toBe(401);
      expect((await call('buyer', 'GET', 'admin/orders')).statusCode).toBe(403);
      expect((await call('buyer', 'GET', 'wallet')).statusCode).toBe(403);
      expect(
        (await call('buyer', 'POST', 'orders', { courseId: c, provider: 'mock', amount: 1 }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await call('admin', 'PUT', 'admin/policy', {
            instructorBps: 8000,
            holdDays: 0,
            minimumWithdrawal: 100000,
            approvalRequired: true,
          })
        ).statusCode,
      ).toBe(200);
      const created = await call('buyer', 'POST', 'orders', { courseId: c, provider: 'mock' });
      expect(created.statusCode).toBe(201);
      const order = created.json().data;
      expect((await call('lecturer', 'GET', `orders/${order.id}`)).statusCode).toBe(404);
      const paid = await call('buyer', 'POST', `orders/${order.id}/mock`, { result: 'success' });
      expect(paid.json().data.status).toBe('paid');
      const lecturerOrders = await call('lecturer', 'GET', `wallet/courses/${c}/orders?page=1&status=paid`);
      expect(lecturerOrders.statusCode).toBe(200);
      expect(lecturerOrders.json().data.items[0].buyer.email).toBe(`${buyer}@test.invalid`);
      expect(lecturerOrders.json().data.summary.paidCount).toBe(1);
      const adminOrders = await call('admin', 'GET', `admin/orders?page=1&q=${buyer}%40test.invalid`);
      expect(adminOrders.json().data.items.some((item: { id: string }) => item.id === order.id)).toBe(true);
      expect((await call('buyer', 'GET', `wallet/courses/${c}/orders`)).statusCode).toBe(403);
      await wallet.releaseIncome(order.id);
      expect(
        (
          await call('lecturer', 'PUT', 'wallet/recipient', {
            method: 'bank',
            institutionCode: 'VCB',
            accountName: 'HTTP TEST',
            accountNumber: '0123456789',
            label: 'HTTP recipient',
            testReference: 'TEST-HTTP',
          })
        ).statusCode,
      ).toBe(200);
      const withdrawal = await call('lecturer', 'POST', 'wallet/withdrawals', {
        amount: 160000,
        idempotencyKey: randomUUID(),
        scenario: 'timeout',
      });
      expect(withdrawal.statusCode).toBe(201);
      const id = withdrawal.json().data.id;
      expect(
        (
          await call('buyer', 'POST', `admin/withdrawals/${id}/decide`, {
            approve: true,
            reason: 'Not authorized',
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await call('admin', 'POST', `admin/withdrawals/${id}/decide`, {
            approve: true,
            reason: 'Approved HTTP test',
          })
        ).statusCode,
      ).toBe(201);
      await wallet.processPayout(id);
      expect((await call('lecturer', 'GET', 'wallet')).json().data.balances.reserved).toBe(160000);
      expect(
        (await call('admin', 'POST', `admin/withdrawals/${id}/mock-result`, { result: 'success' }))
          .statusCode,
      ).toBe(201);
      expect(
        (await call('admin', 'POST', `orders/${order.id}/mock`, { result: 'success' })).statusCode,
      ).toBe(404);
      expect(
        (
          await call('admin', 'POST', `admin/orders/${order.id}/refund`, {
            reason: 'Refund HTTP test',
            amount: 1,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call('admin', 'POST', `admin/orders/${order.id}/refund`, {
            reason: 'Refund HTTP test',
          })
        ).statusCode,
      ).toBe(201);
      expect((await call('buyer', 'GET', `orders/${order.id}`)).json().data.status).toBe(
        'refunded',
      );
      expect((await call('lecturer', 'GET', 'wallet')).json().data.balances.debt).toBe(-160000);
    } finally {
      await app.close();
    }
  }, 30000);
  it('integer rounding always preserves the full amount', () => {
    expect(splitRevenue(100001, 8000)).toEqual({ instructor: 80000, platform: 20001 });
  });
  it('payment callbacks publish one transactional notification', async () => {
    const buyer = await user();
    const externalId = randomUUID();
    await db.$executeRaw`UPDATE users SET external_id=${externalId}::uuid WHERE id=${buyer}::uuid`;
    const c = await course();
    const order = await orders.create(buyer, c, 'mock');
    await orders.mock(buyer, order.id, 'success');
    await orders.mock(buyer, order.id, 'success');
    const [row] = await db.$queryRaw<
      { total: bigint }[]
    >`SELECT count(*) AS total FROM outbox WHERE payload->>'correlationId'=${order.id}`;
    expect(Number(row.total)).toBe(1);
  });
  it('shows buyers only to the course lecturer and notifies that lecturer once', async () => {
    const lecturerExternalId = randomUUID();
    await db.$executeRaw`UPDATE users SET external_id=${lecturerExternalId} WHERE id=${instructor}::uuid`;
    const buyer = await user();
    const c = await course();
    const order = await orders.create(buyer, c, 'mock');
    await orders.mock(buyer, order.id, 'success');
    await orders.mock(buyer, order.id, 'success');
    const own = await orders.listForCourse(instructor, c, 1, { status: 'paid', q: 'Commerce test' });
    expect(own.total).toBe(1);
    expect(own.summary).toEqual({ paidCount: 1, grossAmount: 200000, instructorAmount: 160000 });
    expect(own.items[0].buyer?.email).toBe(`${buyer}@test.invalid`);
    expect((await orders.list(instructor, 1, 'instructor', { status: 'failed' })).total).toBe(0);
    await expect(orders.listForCourse(await user('lecturer'), c, 1, {})).rejects.toThrow();
    const [notification] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM outbox WHERE payload->>'correlationId'=${order.id} AND partition_key=${lecturerExternalId}`;
    expect(Number(notification.total)).toBe(1);
  });
  it('unknown refunds retain funds; definitive failure releases once and preserves access', async () => {
    const { buyer, courseId, order } = await purchase();
    const adapter = jest.spyOn(providers, 'refund').mockResolvedValueOnce('unknown');
    let refund: { id: string };
    try {
      refund = await wallet.refund(admin, order.id, 'Test unknown refund');
    } finally {
      adapter.mockRestore();
    }
    await release(order.id);
    expect((await wallet.summary(instructor)).balances.refund_held).toBe(160000);
    expect((await wallet.summary(instructor)).balances.available).toBe(0);
    await wallet.finishRefund(refund.id, 'failure');
    await wallet.finishRefund(refund.id, 'failure');
    await release(order.id);
    expect((await wallet.summary(instructor)).balances.available).toBe(160000);
    expect((await wallet.summary(instructor)).balances.refund_held).toBe(0);
    await expect(access.requireCourse(buyer, courseId)).resolves.toBeUndefined();
  });
  it('free enrollment creates an independent grant; changing to paid preserves it', async () => {
    const buyer = await user();
    const c = await course(0);
    await access.grantFreeOrRequirePurchase(buyer, c);
    await db.$executeRaw`UPDATE course_prices SET price_vnd=200000 WHERE course_id=${c}::uuid`;
    await expect(access.requireCourse(buyer, c)).resolves.toBeUndefined();
    await expect(orders.create(buyer, c, 'mock')).rejects.toThrow();
  });
  it('unowned paid content and other users financial details are forbidden', async () => {
    const buyer = await user();
    const other = await user();
    const c = await course();
    await expect(access.requireCourse(buyer, c)).rejects.toThrow();
    await expect(access.grantFreeOrRequirePurchase(buyer, c)).rejects.toThrow();
    const o = await orders.create(buyer, c, 'mock');
    await expect(orders.detail(other, o.id)).rejects.toThrow();
    await expect(orders.mock(other, o.id, 'success')).rejects.toThrow();
  });
  it('concurrent checkout/callbacks create one order, enrollment and balanced journal', async () => {
    const buyer = await user();
    const c = await course();
    const [a, b] = await Promise.all([
      orders.create(buyer, c, 'mock'),
      orders.create(buyer, c, 'mock'),
    ]);
    expect(a.id).toBe(b.id);
    await Promise.all([orders.mock(buyer, a.id, 'success'), orders.mock(buyer, a.id, 'success')]);
    await orders.mock(buyer, a.id, 'failure');
    expect((await orders.detail(buyer, a.id)).status).toBe('paid');
    const [r] = await db.$queryRaw<
      { n: bigint; s: bigint }[]
    >`SELECT count(*) AS n,sum(amount)::bigint AS s FROM commerce_entries e JOIN commerce_journals j ON j.id=e.journal_id WHERE j.order_id=${a.id}::uuid`;
    expect(Number(r.n)).toBe(3);
    expect(Number(r.s)).toBe(0);
    expect((await access.offer(buyer, c)).owned).toBe(true);
  });
  it('price and policy updates do not change an existing order', async () => {
    const buyer = await user();
    const c = await course();
    const o = await orders.create(buyer, c, 'mock');
    await db.$executeRaw`UPDATE course_prices SET price_vnd=900000 WHERE course_id=${c}::uuid`;
    await db.$executeRaw`UPDATE commerce_policy SET instructor_bps=6000,hold_days=1`;
    const paid = await orders.mock(buyer, o.id, 'success');
    expect(paid.amount).toBe(200000);
    expect(paid.instructorAmount).toBe(160000);
    expect(paid.instructorBps).toBe(8000);
  });
  it.each(['failure', 'cancelled'] as const)(
    '%s does not grant access or record revenue',
    async (result) => {
      const buyer = await user();
      const c = await course();
      const o = await orders.create(buyer, c, 'mock');
      const r = await orders.mock(buyer, o.id, result);
      expect(r.status).toBe(result === 'failure' ? 'failed' : result);
      expect((await access.offer(buyer, c)).owned).toBe(false);
      expect((await wallet.summary(instructor)).balances.pending).toBe(0);
    },
  );
  it('late success enters review once and never grants access; can be fully refunded', async () => {
    const buyer = await user();
    const c = await course();
    const o = await orders.create(buyer, c, 'mock');
    await db.$executeRaw`UPDATE commerce_orders SET expires_at=now()-interval '1 second' WHERE id=${o.id}::uuid`;
    await orders.mock(buyer, o.id, 'success');
    await orders.apply(
      'mock',
      {
        paymentId: o.payment.id,
        amount: o.amount,
        reference: `mock-${o.payment.id}`,
        result: 'success',
        fingerprint: randomUUID(),
      },
      true,
    );
    expect((await orders.detail(buyer, o.id)).status).toBe('review');
    expect((await access.offer(buyer, c)).owned).toBe(false);
    expect((await wallet.summary(instructor)).balances.pending).toBe(160000);
    await wallet.refund(admin, o.id, 'Late payment test');
    expect((await orders.detail(buyer, o.id)).status).toBe('refunded');
  });
  it('wrong amount is rejected without side effects', async () => {
    const buyer = await user();
    const c = await course();
    const o = await orders.create(buyer, c, 'mock');
    await expect(
      orders.apply('mock', {
        paymentId: o.payment.id,
        amount: 1,
        reference: 'invalid',
        result: 'success',
        fingerprint: randomUUID(),
      }),
    ).rejects.toThrow();
    expect((await orders.detail(buyer, o.id)).status).toBe('pending');
  });
  it('hold/reconciliation gating and repeated release do not duplicate balances', async () => {
    const { order } = await purchase();
    await wallet.releaseIncome(order.id);
    expect((await wallet.summary(instructor)).balances.available).toBe(0);
    await db.$executeRaw`UPDATE commerce_payments SET reconciled_at=NULL WHERE order_id=${order.id}::uuid`;
    await release(order.id);
    expect((await wallet.summary(instructor)).balances.available).toBe(0);
    await db.$executeRaw`UPDATE commerce_payments SET reconciled_at=now() WHERE order_id=${order.id}::uuid`;
    await Promise.all([wallet.releaseIncome(order.id), wallet.releaseIncome(order.id)]);
    expect((await wallet.summary(instructor)).balances.available).toBe(160000);
  });
  it('withdraw minimum/balance/concurrency/idempotency and recipient snapshot', async () => {
    const { order } = await purchase();
    await release(order.id);
    await wallet.recipient(instructor, recipient('Original', 'TEST-ORIGINAL'));
    await expect(wallet.withdraw(instructor, 99999, randomUUID(), 'success')).rejects.toThrow();
    await expect(wallet.withdraw(instructor, 999999, randomUUID(), 'success')).rejects.toThrow();
    const key = randomUUID();
    const results = await Promise.allSettled([
      wallet.withdraw(instructor, 100000, key, 'success'),
      wallet.withdraw(instructor, 100000, randomUUID(), 'success'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const done = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof wallet.withdraw>>
    >;
    await wallet.recipient(instructor, recipient('Changed', 'TEST-CHANGED'));
    expect((done.value.recipient as { label: string }).label).toBe('Original');
    expect((await wallet.summary(instructor)).balances.reserved).toBe(100000);
    await wallet.decide(admin, done.value.id, false, 'Rejected for test');
    expect((await wallet.summary(instructor)).balances.available).toBe(160000);
    await expect(wallet.decide(admin, done.value.id, false, 'Duplicate reject')).rejects.toThrow();
  });
  it.each(['success', 'failure', 'pending', 'timeout'] as const)(
    'mock payout %s retains/releases money correctly and survives duplicates',
    async (scenario) => {
      const { order } = await purchase();
      await release(order.id);
      await wallet.recipient(instructor, recipient('Payout', 'TEST-PAYOUT'));
      const key = randomUUID();
      const w = await wallet.withdraw(instructor, 100000, key, scenario);
      expect((await wallet.withdraw(instructor, 100000, key, scenario)).id).toBe(w.id);
      await wallet.decide(admin, w.id, true, 'Approved for test');
      await Promise.all([wallet.processPayout(w.id), wallet.processPayout(w.id)]);
      const before = (await wallet.summary(instructor)).balances;
      if (scenario === 'success') {
        expect(before.paid).toBe(100000);
        expect(before.reserved).toBe(0);
      } else if (scenario === 'failure') {
        expect(before.available).toBe(160000);
        expect(before.reserved).toBe(0);
      } else {
        expect(before.reserved).toBe(100000);
        await wallet.finishPayout(w.id, 'success');
        expect((await wallet.summary(instructor)).balances.paid).toBe(100000);
      }
      await wallet.finishPayout(w.id, 'success');
      await wallet.finishPayout(w.id, 'failure');
      expect((await wallet.summary(instructor)).balances.reserved).toBe(0);
    },
  );
  it.each(['pending', 'available', 'paid'] as const)(
    'full refund after income %s preserves ledger and independent grants',
    async (state) => {
      const { buyer, courseId, order } = await purchase();
      if (state !== 'pending') await release(order.id);
      if (state === 'paid') {
        await wallet.recipient(instructor, recipient('Refund test', 'TEST-REFUND'));
        const w = await wallet.withdraw(instructor, 160000, randomUUID(), 'success');
        await wallet.decide(admin, w.id, true, 'Approved test');
        await wallet.processPayout(w.id);
      }
      await db.$executeRaw`INSERT INTO course_access_grants(user_id,course_id,source) VALUES (${buyer}::uuid,${courseId}::uuid,'manual')`;
      const refund = await wallet.refund(admin, order.id, 'Full refund test');
      await wallet.finishRefund(refund.id, 'success');
      expect((await orders.detail(buyer, order.id)).status).toBe('refunded');
      expect((await access.offer(buyer, courseId)).owned).toBe(true);
      const b = (await wallet.summary(instructor)).balances;
      expect(b.pending).toBe(0);
      expect(b.available).toBe(0);
      expect(b.debt).toBe(state === 'paid' ? -160000 : 0);
      expect(b.paid).toBe(state === 'paid' ? 160000 : 0);
    },
  );
  it('refund removes only purchased access and future income offsets debt', async () => {
    const { buyer, courseId, order } = await purchase();
    await release(order.id);
    await wallet.recipient(instructor, recipient('Debt', 'TEST-DEBT'));
    const w = await wallet.withdraw(instructor, 160000, randomUUID(), 'success');
    await wallet.decide(admin, w.id, true, 'Approved test');
    await wallet.processPayout(w.id);
    await wallet.refund(admin, order.id, 'Refund debt test');
    await expect(access.requireCourse(buyer, courseId)).rejects.toThrow();
    const next = await purchase();
    await release(next.order.id);
    expect((await wallet.summary(instructor)).balances.debt).toBe(0);
    expect((await wallet.summary(instructor)).balances.available).toBe(0);
  });
  it('database rejects unbalanced journals and mutation of posted entries', async () => {
    const { order } = await purchase();
    await expect(
      db.$executeRaw`UPDATE commerce_entries SET amount=1 WHERE journal_id IN (SELECT id FROM commerce_journals WHERE order_id=${order.id}::uuid)`,
    ).rejects.toThrow();
    await expect(
      store.transaction(async (tx) => {
        const [j] = await tx.$queryRaw<
          { id: string }[]
        >`INSERT INTO commerce_journals(event_key) VALUES (${randomUUID()}) RETURNING id`;
        await tx.$executeRaw`INSERT INTO commerce_entries(journal_id,account,amount) VALUES (${j.id}::uuid,'clearing',1)`;
      }),
    ).rejects.toThrow();
  });
  it('only author/admin can price drafts; published price locked', async () => {
    const c = await course();
    await expect(access.setPrice(actor(instructor), c, 1)).rejects.toThrow();
    await db.$executeRaw`UPDATE courses SET status='draft' WHERE id=${c}::uuid`;
    await expect(access.setPrice(actor(await user('lecturer')), c, 1)).rejects.toThrow();
    await access.setPrice(actor(instructor), c, 250000);
    expect((await access.offer(instructor, c)).priceVnd).toBe(250000);
  });
  it('requires admin approval before applying a lecturer promotion', async () => {
    const buyer = await user();
    const c = await course(200000);
    const now = Date.now();
    const submitted = await access.setPromotion(actor(instructor), c, {
      salePriceVnd: 150000,
      label: 'Ưu đãi kiểm thử',
      startsAt: new Date(now - 60000).toISOString(),
      endsAt: new Date(now + 86400000).toISOString(),
      isActive: true,
    });

    expect(submitted).toMatchObject({ submittedForReview: true, status: 'pending' });
    expect(submitted.requestId).toBeDefined();
    expect(await access.offer(buyer, c)).toMatchObject({
      priceVnd: 200000,
      promotion: null,
    });
    await access.decidePromotionRequest(
      actor(admin, 'admin'),
      submitted.requestId!,
      true,
      'Nội dung và thời gian phù hợp',
    );

    const offer = await access.offer(buyer, c);
    expect(offer).toMatchObject({
      priceVnd: 150000,
      listPriceVnd: 200000,
      salePriceVnd: 150000,
      savingsVnd: 50000,
      discountPercent: 25,
      promotion: { label: 'Ưu đãi kiểm thử', isActive: true },
    });
    expect((await orders.create(buyer, c, 'mock')).amount).toBe(150000);

    const removal = await access.removePromotion(actor(instructor), c);
    expect(removal).toMatchObject({ submittedForReview: true, status: 'pending' });
    expect(removal.requestId).toBeDefined();
    expect((await access.offer(buyer, c)).priceVnd).toBe(150000);
    await access.decidePromotionRequest(
      actor(admin, 'admin'),
      removal.requestId!,
      true,
      'Đồng ý gỡ ưu đãi',
    );
    expect(await access.offer(buyer, c)).toMatchObject({
      priceVnd: 200000,
      listPriceVnd: 200000,
      salePriceVnd: null,
      discountPercent: 0,
      promotion: null,
    });
  });
  it('lets admin manage promotions directly without creating an approval request', async () => {
    const buyer = await user();
    const c = await course(300000);
    const now = Date.now();
    await access.setPromotion(actor(admin, 'admin'), c, {
      salePriceVnd: 240000,
      label: 'Ưu đãi do Admin quản lý',
      startsAt: new Date(now - 60000).toISOString(),
      endsAt: new Date(now + 86400000).toISOString(),
      isActive: true,
    });
    expect(await access.offer(buyer, c)).toMatchObject({
      priceVnd: 240000,
      listPriceVnd: 300000,
      promotion: { label: 'Ưu đãi do Admin quản lý' },
    });
    await access.removePromotion(actor(admin, 'admin'), c);
    expect(await access.offer(buyer, c)).toMatchObject({
      priceVnd: 300000,
      promotion: null,
    });
  });
  it('lets admin apply one campaign to multiple paid courses', async () => {
    const buyer = await user();
    const first = await course(100000);
    const second = await course(250000);
    const now = Date.now();
    await expect(access.setPromotionsBatch(actor(instructor), {
      courseIds: [first, second],
      discountPercent: 20,
      label: 'Ưu đãi theo nhóm',
      startsAt: new Date(now - 60000).toISOString(),
      endsAt: new Date(now + 86400000).toISOString(),
      isActive: true,
    })).rejects.toThrow();
    expect(await access.setPromotionsBatch(actor(admin, 'admin'), {
      courseIds: [first, second],
      discountPercent: 20,
      label: 'Ưu đãi theo nhóm',
      startsAt: new Date(now - 60000).toISOString(),
      endsAt: new Date(now + 86400000).toISOString(),
      isActive: true,
    })).toEqual({ updated: 2 });
    expect(await access.offer(buyer, first)).toMatchObject({ priceVnd: 80000 });
    expect(await access.offer(buyer, second)).toMatchObject({ priceVnd: 200000 });
  });
  it('lets a lecturer submit multiple owned courses for approval without changing public prices', async () => {
    const buyer = await user();
    const first = await course(120000);
    const second = await course(300000);
    const now = Date.now();
    const result = await access.requestPromotionsBatch(actor(instructor), {
      courseIds: [first, second],
      discountPercent: 25,
      label: 'Ưu đãi của giảng viên',
      startsAt: new Date(now - 60000).toISOString(),
      endsAt: new Date(now + 86400000).toISOString(),
      isActive: true,
    });
    expect(result.submitted).toBe(2);
    expect(result.requestIds).toHaveLength(2);
    expect(await access.offer(buyer, first)).toMatchObject({ priceVnd: 120000, promotion: null });
    expect(await access.offer(buyer, second)).toMatchObject({ priceVnd: 300000, promotion: null });
    await access.decidePromotionRequest(
      actor(admin, 'admin'),
      result.requestIds[0],
      true,
      'Chương trình hợp lệ',
    );
    expect(await access.offer(buyer, first)).toMatchObject({ priceVnd: 90000 });
    expect(await access.offer(buyer, second)).toMatchObject({ priceVnd: 300000 });
  });
});

describe('Payment verification', () => {
  it('rejects invalid signatures, merchants and fractional VND', () => {
    const previous = { ...process.env };
    try {
      process.env.NODE_ENV = 'test';
      process.env.COMMERCE_MODE = 'sandbox';
      process.env.VNPAY_TMN_CODE = 'TESTMERCHANT';
      process.env.VNPAY_HASH_SECRET = 'not-a-real-credential';
      process.env.COMMERCE_PUBLIC_API_URL = 'https://example.invalid/api/v1';
      const p = new PaymentProviders();
      const fields = {
        vnp_TmnCode: 'TESTMERCHANT',
        vnp_Amount: '20000000',
        vnp_TxnRef: randomUUID(),
        vnp_TransactionNo: '123',
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
      };
      expect(() => p.verify('vnpay', { ...fields, vnp_SecureHash: 'bad' })).toThrow();
      const signed = {
        ...fields,
        vnp_SecureHash: mac(vnpCanonical(fields), 'not-a-real-credential'),
      };
      expect(p.verify('vnpay', signed).result).toBe('success');
      expect(() => p.verify('vnpay', { ...signed, vnp_Amount: '1' })).toThrow();
    } finally {
      process.env = previous;
    }
  });
  it('production disables all money mutations and mock endpoints', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const p = new PaymentProviders();
      expect(p.methods()).toEqual([]);
      expect(() => p.assertMock()).toThrow();
      expect(() => p.assertEnabled()).toThrow();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
