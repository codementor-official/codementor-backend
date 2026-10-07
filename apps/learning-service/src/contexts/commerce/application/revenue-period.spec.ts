import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RevenuePeriod } from '../presentation/commerce.dto';
import { revenuePeriod } from './revenue-period';

describe('Revenue calendar window', () => {
  it.each([7, 30, 90])('preserves the %i-day Vietnam preset', (days) => {
    const period = revenuePeriod(days);
    expect(period.start.values).toEqual([days]);
    expect(period.start.sql).toContain('Asia/Ho_Chi_Minh');
  });
  it.each([
    { from: '2026-10-01', to: '2026-10-01' },
    { from: '2024-02-29', to: '2024-02-29' },
    { from: '2024-01-01', to: '2024-12-31' },
  ])('accepts inclusive days without UTC-shifting the query: %o', (range) => {
    const period = revenuePeriod(30, range);
    expect(period.start.values).toEqual([range.from]);
    expect(period.end.values).toEqual([range.to]);
    expect(period.start.sql).toBe('?::date');
  });
  it.each([
    { from: '2026-10-01' }, { to: '2026-10-01' },
    { from: '', to: '2026-10-01' },
    { from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '0000-01-01', to: '0000-01-01' },
    { from: '2026-10-02', to: '2026-10-01' },
    { from: '2024-01-01', to: '2025-01-01' },
    { from: '2026-10-01T00:00:00Z', to: '2026-10-02' },
    { from: "2026-10-01';DROP TABLE commerce_orders", to: '2026-10-02' },
  ])('rejects incomplete, invalid or oversized calendar windows: %o', (range) => {
    expect(() => revenuePeriod(30, range)).toThrow();
  });
  it('validates date query syntax at the HTTP boundary and preserves the default preset', async () => {
    const valid = plainToInstance(RevenuePeriod, { from: '2026-10-01', to: '2026-10-07' });
    expect(valid.days).toBe(30);
    expect(await validate(valid)).toEqual([]);
    const invalid = plainToInstance(RevenuePeriod, { from: '2026-02-30', to: '2026-10-07' });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});
