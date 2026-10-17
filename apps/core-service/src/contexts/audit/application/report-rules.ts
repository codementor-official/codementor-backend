// Luật thuần của báo cáo vi phạm — không import framework, để test chạy không cần Nest/Prisma.

/** Một tài khoản gửi tối đa một báo cáo mỗi khoảng này — chặn spam hàng chờ kiểm duyệt. */
export const REPORT_COOLDOWN_SECONDS = 10 * 60;

/** Số giây còn phải chờ trước khi gửi tiếp, 0 nếu gửi được. */
export function reportCooldownLeft(lastSubmittedAt: Date | null, now: Date): number {
  if (!lastSubmittedAt) return 0;
  const elapsed = (now.getTime() - lastSubmittedAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(REPORT_COOLDOWN_SECONDS - elapsed));
}

/** Các mức khoá admin chọn được; `null` là khoá không thời hạn (tới khi có người mở). */
export const SUSPENSION_DAYS = [1, 3, 7, 30] as const;
export type SuspensionDays = (typeof SUSPENSION_DAYS)[number];

export function suspensionEndsAt(days: SuspensionDays | null, now: Date): Date | null {
  return days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

interface ActionLike {
  id: string;
  action: 'STATUS_CHANGED' | 'USER_SUSPENDED' | 'ROLLED_BACK';
  revertedAt: Date | null;
  createdAt: Date;
}

/**
 * Vì sao một thao tác KHÔNG hoàn tác được, hoặc `null` nếu được.
 *
 * Trạng thái hoàn tác theo kiểu ngăn xếp: chỉ thao tác đổi trạng thái MỚI NHẤT còn hiệu lực —
 * hoàn tác một bước cũ hơn sẽ ghi đè lên kết luận của những bước sau mà không ai thấy. Khoá tài
 * khoản thì độc lập với trạng thái báo cáo nên hoàn tác lúc nào cũng được, miễn chưa hoàn tác.
 */
export function rollbackBlocker(
  target: Omit<ActionLike, 'createdAt'>,
  history: ActionLike[],
): string | null {
  if (target.action === 'ROLLED_BACK') return 'Không hoàn tác một lần hoàn tác.';
  if (target.revertedAt) return 'Thao tác này đã được hoàn tác.';
  if (target.action === 'USER_SUSPENDED') return null;
  const latest = history
    .filter((row) => row.action === 'STATUS_CHANGED' && !row.revertedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return latest?.id === target.id ? null : 'Chỉ hoàn tác được lần đổi trạng thái gần nhất.';
}
