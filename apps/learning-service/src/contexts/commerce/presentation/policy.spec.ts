import 'reflect-metadata';
import { validate } from 'class-validator';
import { PolicyDto } from './commerce.dto';

describe('Configurable revenue holding period', () => {
  const policy = (holdDays: number) => Object.assign(new PolicyDto(), {
    instructorBps: 8000, holdDays, minimumWithdrawal: 100000, approvalRequired: true,
  });
  it.each([0, 3, 7, 30, 90])('accepts %i days instead of requiring a hard-coded week', async (days) => {
    expect(await validate(policy(days))).toEqual([]);
  });
  it.each([-1, 91, 1.5, NaN])('rejects invalid days: %s', async (days) => {
    expect((await validate(policy(days))).some((e) => e.property === 'holdDays')).toBe(true);
  });
  it.each([0, 1, 60, 1440, 129600])('accepts exact holding minutes: %i', async (minutes) => {
    expect(await validate(Object.assign(policy(Math.ceil(minutes / 1440)), { holdMinutes: minutes }))).toEqual([]);
  });
  it.each([-1, 129601, 1.5, NaN, '1'])('rejects invalid minutes: %s', async (minutes) => {
    expect((await validate(Object.assign(policy(1), { holdMinutes: minutes }))).some(e => e.property === 'holdMinutes')).toBe(true);
  });
});
