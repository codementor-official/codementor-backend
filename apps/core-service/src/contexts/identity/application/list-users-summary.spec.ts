import { summarize } from './list-users.usecase';

// Tách khỏi Passport/JWKS (ESM) mà barrel `@codementor/platform` kéo theo.
jest.mock('@codementor/platform', () => ({}));

describe('summarize', () => {
  it('cộng dồn từng nhóm (vai trò, trạng thái) vào cả hai chiều và tổng', () => {
    const stats = summarize([
      { role: 'learner', status: 'active', count: 10n, recent: 3n },
      { role: 'learner', status: 'suspended', count: 2n, recent: 0n },
      { role: 'lecturer', status: 'active', count: 4n, recent: 1n },
    ]);

    expect(stats).toEqual({
      total: 16,
      byRole: { learner: 12, lecturer: 4 },
      byStatus: { active: 14, suspended: 2 },
      newLast30Days: 4,
    });
  });

  it('bảng rỗng ra toàn số 0, không undefined', () => {
    expect(summarize([])).toEqual({ total: 0, byRole: {}, byStatus: {}, newLast30Days: 0 });
  });
});
