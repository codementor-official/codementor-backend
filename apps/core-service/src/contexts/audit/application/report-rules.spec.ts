import { reportCooldownLeft, rollbackBlocker, suspensionEndsAt } from './report-rules';

describe('reportCooldownLeft', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  it('lets a first report through', () => expect(reportCooldownLeft(null, now)).toBe(0));
  it('blocks for the rest of the 10 minutes', () =>
    expect(reportCooldownLeft(new Date('2026-10-17T09:55:30Z'), now)).toBe(330));
  it('opens again once 10 minutes have passed', () =>
    expect(reportCooldownLeft(new Date('2026-10-17T09:50:00Z'), now)).toBe(0));
});

describe('rollbackBlocker', () => {
  const at = (minute: number) => new Date(`2026-10-17T10:${String(minute).padStart(2, '0')}:00Z`);
  const resolve = {
    id: 'a',
    action: 'STATUS_CHANGED' as const,
    revertedAt: null,
    createdAt: at(1),
  };
  const reopen = { id: 'b', action: 'STATUS_CHANGED' as const, revertedAt: null, createdAt: at(2) };
  const suspend = {
    id: 'c',
    action: 'USER_SUSPENDED' as const,
    revertedAt: null,
    createdAt: at(0),
  };
  const history = [suspend, resolve, reopen];

  it('allows only the latest live status change', () => {
    expect(rollbackBlocker(reopen, history)).toBeNull();
    expect(rollbackBlocker(resolve, history)).toMatch(/gần nhất/);
  });
  it('unblocks the earlier change once the later one is reverted', () => {
    const reverted = { ...reopen, revertedAt: at(3) };
    expect(rollbackBlocker(resolve, [suspend, resolve, reverted])).toBeNull();
    expect(rollbackBlocker(reverted, [suspend, resolve, reverted])).toMatch(/đã được hoàn tác/);
  });
  it('lets a suspension be undone regardless of later status changes', () =>
    expect(rollbackBlocker(suspend, history)).toBeNull());
  it('never undoes an undo', () =>
    expect(rollbackBlocker({ id: 'd', action: 'ROLLED_BACK', revertedAt: null }, history)).toMatch(
      /Không hoàn tác/,
    ));
});

describe('suspensionEndsAt', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  it('adds whole days', () =>
    expect(suspensionEndsAt(7, now)?.toISOString()).toBe('2026-10-24T10:00:00.000Z'));
  it('has no end for an indefinite suspension', () =>
    expect(suspensionEndsAt(null, now)).toBeNull());
});
