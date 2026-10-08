import 'reflect-metadata';
import { HttpException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { CommerceController } from './commerce.controller';
import type { FastifyReply } from 'fastify';
jest.mock('@codementor/platform', () => {
  const { SetMetadata, createParamDecorator } = jest.requireActual('@nestjs/common');
  return {
    PrismaService: class {},
    Roles: (...roles: string[]) => SetMetadata('codementor:roles', roles),
    Public: () => SetMetadata('public', true),
    CurrentUser: createParamDecorator(() => undefined),
    requireHumanId: () => 'admin-id',
  };
});

describe('Admin jobs and holding policy controller (no real database)', () => {
  const jobs = { tick: jest.fn().mockResolvedValue({ runId: 'run', stages: [] }) };
  const providers = { assertEnabled: jest.fn() };
  const execute = jest.fn().mockResolvedValue(1);
  const store = { transaction: jest.fn(async (work) => work({ $executeRaw: execute })) };
  const controller = new CommerceController(
    {} as never, {} as never, {} as never, providers as never,
    store as never, jobs as never, {} as never,
  );
  beforeEach(() => jest.clearAllMocks());
  it('returns the job report on Admin-only POST', async () => {
    expect(Reflect.getMetadata(METHOD_METADATA, controller.run)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('codementor:roles', controller.run)).toEqual(['admin']);
    await expect(controller.run()).resolves.toEqual({ runId: 'run', stages: [] });
    expect(jobs.tick).toHaveBeenCalledTimes(1);
  });
  it('GET is 405 with Allow POST and cannot start a financial task', () => {
    const header = jest.fn();
    try {
      controller.runMethodInfo({ header } as unknown as FastifyReply);
      throw new Error('Expected 405');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(405);
    }
    expect(header).toHaveBeenCalledWith('Allow', 'POST');
    expect(jobs.tick).not.toHaveBeenCalled();
    expect(Reflect.getMetadata('codementor:roles', controller.runMethodInfo)).toEqual(['admin']);
  });
  it('saves dynamic holding days and audits policy without updating historical orders', async () => {
    const policy = { instructorBps: 8000, holdDays: 3, minimumWithdrawal: 100000, approvalRequired: true };
    await expect(controller.setPolicy({} as never, policy)).resolves.toEqual(policy);
    expect(Reflect.getMetadata('codementor:roles', controller.setPolicy)).toEqual(['admin']);
    expect(execute).toHaveBeenCalledTimes(2);
    const sql = execute.mock.calls[0][0].join('');
    expect(sql).toContain('UPDATE commerce_policy');
    expect(sql).toContain('hold_days=');
    expect(execute.mock.calls[0]).toContain(3);
    expect(execute.mock.calls.map(([strings]) => strings.join('')).join('')).not.toContain('UPDATE commerce_orders');
    expect(execute.mock.calls[1]).toContain('policy.updated');
  });
  it('saves a one-minute policy, without rewriting historical orders or releasing money', async () => {
    const policy = { instructorBps: 8000, holdDays: 1, holdMinutes: 1, minimumWithdrawal: 100000, approvalRequired: true };
    await expect(controller.setPolicy({} as never, policy)).resolves.toEqual(policy);
    expect(execute.mock.calls[0][0].join('')).toContain('hold_minutes=');
    expect(execute.mock.calls[0]).toContain(1);
    expect(execute.mock.calls.map(([s]) => s.join('')).join('')).not.toContain('UPDATE commerce_orders');
    expect(jobs.tick).not.toHaveBeenCalled();
  });
  it('rejects inconsistent units before any database mutation', async () => {
    await expect(controller.setPolicy({} as never, { instructorBps: 8000, holdDays: 7, holdMinutes: 1, minimumWithdrawal: 100000, approvalRequired: true })).rejects.toThrow('không nhất quán');
    expect(execute).not.toHaveBeenCalled();
  });
});
