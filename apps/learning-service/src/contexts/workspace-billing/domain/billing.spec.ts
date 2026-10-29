import {
  addBillingPeriod,
  classifyChange,
  couponDiscount,
  priceFor,
  prorationCredit,
  renewable,
  subscriptionState,
  versionProblems,
} from './billing';

const at = (iso: string) => new Date(iso);

describe('addBillingPeriod', () => {
  it('adds a calendar month and keeps the time of day', () => {
    expect(addBillingPeriod(at('2026-10-29T08:15:00Z'), 'month')).toEqual(at('2026-11-29T08:15:00Z'));
  });
  it('clamps to the last day of a shorter month', () => {
    expect(addBillingPeriod(at('2026-01-31T00:00:00Z'), 'month')).toEqual(at('2026-02-28T00:00:00Z'));
    expect(addBillingPeriod(at('2028-01-31T00:00:00Z'), 'month')).toEqual(at('2028-02-29T00:00:00Z'));
  });
  it('rolls over the year', () => {
    expect(addBillingPeriod(at('2026-12-15T00:00:00Z'), 'month')).toEqual(at('2027-01-15T00:00:00Z'));
    expect(addBillingPeriod(at('2028-02-29T00:00:00Z'), 'year')).toEqual(at('2029-02-28T00:00:00Z'));
  });
});

describe('prorationCredit', () => {
  const start = at('2026-10-01T00:00:00Z');
  const end = at('2026-10-31T00:00:00Z');
  it('credits the unused share, rounded down', () => {
    expect(prorationCredit(99_000, start, end, at('2026-10-16T00:00:00Z'))).toBe(49_500);
    expect(prorationCredit(100_000, start, end, at('2026-10-11T00:00:00Z'))).toBe(66_666);
  });
  it('credits everything before the term starts and nothing after it ends', () => {
    expect(prorationCredit(99_000, start, end, at('2026-09-01T00:00:00Z'))).toBe(99_000);
    expect(prorationCredit(99_000, start, end, at('2026-11-01T00:00:00Z'))).toBe(0);
  });
  it('never credits an invalid amount', () => {
    expect(prorationCredit(0, start, end, start)).toBe(0);
    expect(prorationCredit(1.5, start, end, start)).toBe(0);
  });
});

describe('couponDiscount', () => {
  it('applies percentages in whole VND', () => {
    expect(couponDiscount({ kind: 'percent', value: 15 }, 99_000)).toBe(14_850);
    expect(couponDiscount({ kind: 'percent', value: 33 }, 99_999)).toBe(32_999);
  });
  it('never drops the charge below the gateway minimum', () => {
    expect(couponDiscount({ kind: 'percent', value: 100 }, 99_000)).toBe(94_000);
    expect(couponDiscount({ kind: 'fixed', value: 500_000 }, 99_000)).toBe(94_000);
  });
});

describe('priceFor', () => {
  it('returns null for cycles that are not offered', () => {
    expect(priceFor({ monthlyPriceVnd: 0, annualPriceVnd: null }, 'month')).toBeNull();
    expect(priceFor({ monthlyPriceVnd: 99_000, annualPriceVnd: null }, 'year')).toBeNull();
    expect(priceFor({ monthlyPriceVnd: 99_000, annualPriceVnd: 990_000 }, 'year')).toBe(990_000);
  });
});

describe('classifyChange', () => {
  const plus = { planId: 'plus', sortOrder: 1, cycle: 'month' as const };
  it('distinguishes every kind of change', () => {
    expect(classifyChange(null, plus)).toBe('new');
    expect(classifyChange(plus, plus)).toBe('renewal');
    expect(classifyChange(plus, { ...plus, cycle: 'year' })).toBe('cycle_change');
    expect(classifyChange(plus, { planId: 'pro', sortOrder: 2, cycle: 'month' })).toBe('upgrade');
    expect(classifyChange(plus, { planId: 'free', sortOrder: 0, cycle: 'month' })).toBe('downgrade');
  });
});

describe('subscriptionState', () => {
  const now = at('2026-10-29T00:00:00Z');
  const base = { paidThrough: at('2026-11-10T00:00:00Z'), covered: true, cancelAtPeriodEnd: false, suspended: false, graceDays: 7 };
  it('follows the paid term', () => {
    expect(subscriptionState(null, now)).toBe('FREE');
    expect(subscriptionState(base, now)).toBe('ACTIVE');
    expect(subscriptionState({ ...base, cancelAtPeriodEnd: true }, now)).toBe('CANCEL_SCHEDULED');
    expect(subscriptionState({ ...base, suspended: true }, now)).toBe('SUSPENDED');
  });
  it('keeps a grace period only when renewal was not cancelled', () => {
    const lapsed = { ...base, covered: false, paidThrough: at('2026-10-25T00:00:00Z') };
    expect(subscriptionState(lapsed, now)).toBe('GRACE_PERIOD');
    expect(subscriptionState({ ...lapsed, cancelAtPeriodEnd: true }, now)).toBe('CANCELLED');
    expect(subscriptionState({ ...lapsed, paidThrough: at('2026-10-20T00:00:00Z') }, now)).toBe('EXPIRED');
    expect(subscriptionState({ ...lapsed, paidThrough: at('2026-10-22T00:00:00Z') }, now)).toBe('EXPIRED');
  });
  it('allows renewal only while the contract is alive', () => {
    expect(renewable('GRACE_PERIOD')).toBe(true);
    expect(renewable('EXPIRED')).toBe(false);
    expect(renewable('CANCELLED')).toBe(false);
  });
});

describe('versionProblems', () => {
  const valid = {
    isDefault: false,
    monthlyPriceVnd: 99_000,
    annualPriceVnd: 990_000,
    maxOwnedGroups: 5,
    maxMembersPerGroup: 50,
    maxStorageBytes: 2 * 1024 ** 3,
    maxUploadBytes: 100 * 1024 ** 2,
    monthlyAiRequests: 200,
    features: [] as never[],
  };
  it('accepts the seeded Plus plan', () => {
    expect(versionProblems(valid)).toEqual([]);
  });
  it('rejects prices outside the gateway range and a paid default plan', () => {
    expect(versionProblems({ ...valid, monthlyPriceVnd: 1_000 })).toHaveLength(1);
    expect(versionProblems({ ...valid, monthlyPriceVnd: -1 })).toHaveLength(1);
    expect(versionProblems({ ...valid, isDefault: true })).toEqual(['The default plan must be free.']);
  });
  it('rejects a file limit above total storage and impossible member limits', () => {
    expect(versionProblems({ ...valid, maxUploadBytes: valid.maxStorageBytes + 1 })).toHaveLength(1);
    expect(versionProblems({ ...valid, maxMembersPerGroup: 1 })).toHaveLength(1);
    expect(versionProblems({ ...valid, maxMembersPerGroup: null })).toEqual([]);
  });
});
