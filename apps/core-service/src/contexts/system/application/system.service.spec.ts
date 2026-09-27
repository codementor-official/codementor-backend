import { classifyHealth } from './system.service';

// Tách khỏi Passport/JWKS (ESM) mà barrel `@codementor/platform` kéo theo.
jest.mock('@codementor/platform', () => ({ PrismaService: class {} }));

describe('classifyHealth', () => {
  it('chỉ "up" khi HTTP 2xx và thân báo ok, ở cả hai dạng thân', () => {
    expect(classifyHealth(true, { data: { status: 'ok' } })).toBe('up'); // Nest, qua interceptor
    expect(classifyHealth(true, { status: 'ok', engine: 'docker' })).toBe('up'); // judge
  });

  it('HTTP 200 nhưng mất database là degraded, không phải up', () => {
    expect(classifyHealth(true, { data: { status: 'degraded', dependencies: { postgres: false } } })).toBe(
      'degraded',
    );
    expect(classifyHealth(true, null)).toBe('degraded');
  });

  it('HTTP lỗi là down', () => {
    expect(classifyHealth(false, { status: 'ok' })).toBe('down');
  });
});
