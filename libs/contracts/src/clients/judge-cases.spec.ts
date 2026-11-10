import { redactHiddenCases } from './judge-cases';

const outcome = (order: number, expected: string) => ({
  order,
  verdict: 'wrong_answer',
  expected,
  actual: '[]',
  stderr: 'trace',
  runtimeMs: 3,
  memoryKb: 100,
});

describe('redactHiddenCases', () => {
  const testCases = [
    { order: 1, visibility: 'public' },
    { order: 2, visibility: 'hidden' },
    { order: 3 },
  ];
  const cases = [outcome(1, '[2, 7]'), outcome(2, '918273645'), outcome(3, 'vortex quartz')];

  it('giữ nguyên test công khai', () => {
    expect(redactHiddenCases(cases, testCases)[0]).toEqual(cases[0]);
  });

  it('test ẩn mất expected, actual, stderr nhưng giữ thời gian và bộ nhớ', () => {
    expect(redactHiddenCases(cases, testCases)[1]).toEqual({
      order: 2,
      verdict: 'wrong_answer',
      hidden: true,
      runtimeMs: 3,
      memoryKb: 100,
    });
  });

  it('test thiếu visibility bị coi là ẩn', () => {
    expect(redactHiddenCases(cases, testCases)[2]).toMatchObject({ order: 3, hidden: true });
    expect(JSON.stringify(redactHiddenCases(cases, testCases))).not.toMatch(/918273645|vortex/);
  });

  it('case không có trong danh sách test cũng bị coi là ẩn', () => {
    expect(redactHiddenCases([outcome(9, 'x')], testCases)[0]).toMatchObject({ hidden: true });
  });
});
