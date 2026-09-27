/**
 * Số liệu trang Chấm bài của admin. Chỉ gồm bài NỘP (`submissions`); lượt "Chạy thử" của
 * judge không được lưu nên không có ở đây.
 */
export interface SubmissionStats {
  days: number;
  /** Mọi lượt nộp trong cửa sổ, kể cả đang `pending`. */
  total: number;
  /** Đã chấm xong (khác `pending`) — mẫu số đúng cho tỉ lệ AC. */
  completed: number;
  accepted: number;
  byVerdict: Record<string, number>;
  byLanguage: LanguageStats[];
  /** `null` khi cửa sổ chưa có bài nào chấm xong. */
  runtimeMs: { p50: number | null; p95: number | null };
  memoryKb: { p50: number | null; p95: number | null };
  /**
   * `pending` lâu hơn 5 phút, tính trên toàn bảng chứ không theo cửa sổ. Chấm là đồng bộ
   * (submission gọi thẳng judge), nên một lượt còn `pending` sau 5 phút là lượt judge đã
   * lỗi hoặc không trả lời — nó sẽ không bao giờ tự xong.
   */
  stuckPending: number;
  daily: { date: string; total: number; accepted: number }[];
}

export interface LanguageStats {
  language: string;
  total: number;
  accepted: number;
  avgRuntimeMs: number | null;
}

export interface VerdictLanguageRow {
  language: string;
  verdict: string;
  count: number;
  /** Tổng `runtime_ms` của nhóm (bỏ NULL) và số dòng có `runtime_ms`, để tính TB có trọng số. */
  runtimeSum: number;
  runtimeCount: number;
}

/** Gộp các nhóm (ngôn ngữ, verdict) thành hai chiều. Nhiều ngôn ngữ nhất lên đầu. */
export function foldVerdictLanguage(rows: VerdictLanguageRow[]) {
  const byVerdict: Record<string, number> = {};
  const languages = new Map<string, LanguageStats & { runtimeSum: number; runtimeCount: number }>();
  let total = 0;
  let accepted = 0;

  for (const row of rows) {
    total += row.count;
    byVerdict[row.verdict] = (byVerdict[row.verdict] ?? 0) + row.count;
    const language = languages.get(row.language) ?? {
      language: row.language,
      total: 0,
      accepted: 0,
      avgRuntimeMs: null,
      runtimeSum: 0,
      runtimeCount: 0,
    };
    language.total += row.count;
    language.runtimeSum += row.runtimeSum;
    language.runtimeCount += row.runtimeCount;
    if (row.verdict === 'accepted') {
      language.accepted += row.count;
      accepted += row.count;
    }
    languages.set(row.language, language);
  }

  const byLanguage = [...languages.values()]
    .map(({ runtimeSum, runtimeCount, ...language }) => ({
      ...language,
      avgRuntimeMs: runtimeCount ? Math.round(runtimeSum / runtimeCount) : null,
    }))
    .sort((a, b) => b.total - a.total || a.language.localeCompare(b.language));

  return { total, accepted, completed: total - (byVerdict.pending ?? 0), byVerdict, byLanguage };
}
