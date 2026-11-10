/**
 * Thứ học viên được thấy của một lần chấm.
 *
 * Judge trả `expected`/`actual`/`stderr` của MỌI test, kể cả test ẩn. Người ra đề và người duyệt
 * cần bản đầy đủ (lưu ở DB và run detail), nhưng bản gửi cho học viên — và qua trình duyệt tới
 * Codey — chỉ được giữ chi tiết của test công khai. Lọc nội dung bài (`toLearnerExerciseContent`)
 * mà quên lọc kết quả chấm là để lộ đầu ra test ẩn qua đường khác.
 */
export interface JudgeCaseOutcome {
  order: number;
  verdict: string;
  /** Run detail (judge `run_details.py`) có thêm cờ này. */
  passed?: boolean;
  expected?: string;
  actual?: string;
  stderr?: string;
  runtimeMs?: number;
  memoryKb?: number;
}

export interface HiddenCaseOutcome {
  order: number;
  verdict: string;
  passed?: boolean;
  hidden: true;
  runtimeMs?: number;
  memoryKb?: number;
}

/**
 * Giữ nguyên test có `visibility === 'public'`; mọi test khác (kể cả thiếu `visibility`) coi là ẩn
 * và chỉ còn `order`, `verdict`, `passed`, thời gian, bộ nhớ — cùng luật với
 * `toLearnerExerciseContent`. Danh sách CHO PHÉP chứ không phải danh sách cấm: trường mới thêm vào
 * kết quả chấm (vd `input`) mặc định không lọt ra.
 */
export function redactHiddenCases(
  cases: readonly JudgeCaseOutcome[],
  testCases: ReadonlyArray<{ order?: unknown; visibility?: unknown }>,
): Array<JudgeCaseOutcome | HiddenCaseOutcome> {
  const publicOrders = new Set(
    testCases
      .filter((testCase) => testCase.visibility === 'public')
      .map((testCase) => testCase.order),
  );
  return cases.map((outcome) =>
    publicOrders.has(outcome.order)
      ? outcome
      : {
          order: outcome.order,
          verdict: outcome.verdict,
          hidden: true as const,
          ...(outcome.passed !== undefined ? { passed: outcome.passed } : {}),
          ...(outcome.runtimeMs !== undefined ? { runtimeMs: outcome.runtimeMs } : {}),
          ...(outcome.memoryKb !== undefined ? { memoryKb: outcome.memoryKb } : {}),
        },
  );
}
