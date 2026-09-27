import { foldVerdictLanguage } from './submission-stats';

describe('foldVerdictLanguage', () => {
  it('gộp theo verdict và theo ngôn ngữ; tỉ lệ AC dùng mẫu số là bài đã chấm xong', () => {
    const result = foldVerdictLanguage([
      { language: 'python', verdict: 'accepted', count: 6, runtimeSum: 600, runtimeCount: 6 },
      { language: 'python', verdict: 'wrong_answer', count: 2, runtimeSum: 400, runtimeCount: 2 },
      { language: 'cpp', verdict: 'accepted', count: 1, runtimeSum: 10, runtimeCount: 1 },
      // `pending` chưa có runtime: không được kéo trung bình về 0.
      { language: 'cpp', verdict: 'pending', count: 3, runtimeSum: 0, runtimeCount: 0 },
    ]);

    expect(result).toEqual({
      total: 12,
      completed: 9,
      accepted: 7,
      byVerdict: { accepted: 7, wrong_answer: 2, pending: 3 },
      byLanguage: [
        { language: 'python', total: 8, accepted: 6, avgRuntimeMs: 125 },
        { language: 'cpp', total: 4, accepted: 1, avgRuntimeMs: 10 },
      ],
    });
  });

  it('không có dữ liệu thì runtime là null, không phải 0', () => {
    expect(
      foldVerdictLanguage([
        { language: 'go', verdict: 'pending', count: 1, runtimeSum: 0, runtimeCount: 0 },
      ]).byLanguage[0].avgRuntimeMs,
    ).toBeNull();
  });
});
