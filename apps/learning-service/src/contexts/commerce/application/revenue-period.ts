import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface RevenueDateRange { from?: string; to?: string }

/** Inclusive calendar days in Vietnam; a bounded, read-only reporting window. */
export function revenuePeriod(days: number, range?: RevenueDateRange) {
  if (![7, 30, 90].includes(days))
    throw new BadRequestException('Chọn khoảng thời gian 7, 30 hoặc 90 ngày');
  if (range?.from !== undefined || range?.to !== undefined) {
    const dateValue = (value?: string) => {
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return NaN;
      const timestamp = Date.parse(`${value}T00:00:00Z`);
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
        ? timestamp : NaN;
    };
    const from = dateValue(range.from), to = dateValue(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to))
      throw new BadRequestException('Nhập đầy đủ ngày bắt đầu và kết thúc hợp lệ (YYYY-MM-DD)');
    if (from > to) throw new BadRequestException('Ngày kết thúc phải từ ngày bắt đầu trở đi');
    if ((to - from) / 86400000 + 1 > 366)
      throw new BadRequestException('Chọn tối đa 366 ngày cho mỗi báo cáo');
    return { start: Prisma.sql`${range!.from}::date`, end: Prisma.sql`${range!.to}::date` };
  }
  return {
    start: Prisma.sql`(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-(${days}::int-1)`,
    end: Prisma.sql`(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
  };
}
