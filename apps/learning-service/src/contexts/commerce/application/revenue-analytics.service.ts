import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommerceStore } from '../infrastructure/commerce.store';
import { revenuePeriod, type RevenueDateRange } from './revenue-period';

interface Aggregate {
  date: string; courseId: string; courseTitle: string; status: string;
  orders: bigint; gross: bigint; share: bigint;
}
export function revenueReport(rows: Aggregate[], dates: string[], scope: 'admin' | 'lecturer') {
  const daily = dates.map((date) => ({ date, gross: 0, revenue: 0, refunded: 0, orders: 0 }));
  const courses = new Map<string, { id: string; title: string; gross: number; revenue: number; orders: number }>();
  const statuses: Record<string, number> = {};
  let gross = 0, revenue = 0, refunded = 0, paidOrders = 0;
  for (const row of rows) {
    const count = Number(row.orders);
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(Number(row.gross)) || !Number.isSafeInteger(Number(row.share)))
      throw new Error('Revenue exceeds safe integer range');
    statuses[row.status] = (statuses[row.status] ?? 0) + count;
    if (!['paid', 'refunded'].includes(row.status)) continue;
    const amount = Number(row.gross), share = Number(row.share);
    gross += amount;
    paidOrders += count;
    const net = row.status === 'paid' ? share : 0;
    revenue += net;
    refunded += row.status === 'refunded' ? amount : 0;
    const point = daily.find((d) => d.date === row.date);
    if (point) { point.gross += amount; point.revenue += net; point.orders += count; point.refunded += row.status === 'refunded' ? amount : 0; }
    const course = courses.get(row.courseId) ?? { id: row.courseId, title: row.courseTitle, gross: 0, revenue: 0, orders: 0 };
    course.gross += amount; course.revenue += net; course.orders += count;
    courses.set(course.id, course);
  }
  if (![gross, revenue, refunded, paidOrders].every(Number.isSafeInteger))
    throw new Error('Revenue exceeds safe integer range');
  return { scope, from: dates[0], to: dates.at(-1), timezone: 'Asia/Ho_Chi_Minh',
    totals: { gross, revenue, refunded, paidOrders }, daily,
    courses: [...courses.values()].sort((a, b) => b.revenue - a.revenue || a.id.localeCompare(b.id)), statuses,
  };
}

@Injectable()
export class RevenueAnalyticsService {
  constructor(private readonly store: CommerceStore) {}
  async report(days: number, instructorId?: string, requestedScope?: 'admin', range?: RevenueDateRange) {
    const period = revenuePeriod(days, range);
    // One row per order, no payment/refund joins that could multiply amounts.
    // Paid cohorts use settlement day; unpaid orders use creation day.
    const scope = instructorId ? Prisma.sql`AND instructor_id=${instructorId}::uuid` : Prisma.empty;
    const share = instructorId && requestedScope !== 'admin' ? Prisma.sql`instructor_amount` : Prisma.sql`platform_amount`;
    return this.store.transaction(async (tx) => {
      const dates = await tx.$queryRaw<{ date: string }[]>`SELECT to_char(d,'YYYY-MM-DD') AS date
        FROM generate_series(${period.start}, ${period.end}, interval '1 day') d`;
      const rows = await tx.$queryRaw<Aggregate[]>`SELECT
        to_char(COALESCE(settled_at,created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS date,
        course_id AS "courseId", max(course_title) AS "courseTitle", status,
        count(*)::bigint AS orders, sum(amount)::bigint AS gross, sum(${share})::bigint AS share
        FROM commerce_orders WHERE COALESCE(settled_at,created_at)>=${dates[0].date}::date AT TIME ZONE 'Asia/Ho_Chi_Minh'
        AND COALESCE(settled_at,created_at)<(${dates.at(-1)!.date}::date+1) AT TIME ZONE 'Asia/Ho_Chi_Minh' ${scope}
        GROUP BY date,course_id,status`;
      return revenueReport(rows, dates.map((d) => d.date), requestedScope ?? (instructorId ? 'lecturer' : 'admin'));
    });
  }
  async instructors(days: number, range?: RevenueDateRange) {
    const period = revenuePeriod(days, range);
    // Independent aggregates avoid multiplying orders by ledger entries. Balances
    // are all-time ledger values, while revenue is the explicitly selected cohort.
    const rows = await this.store.db.$queryRaw<Array<{
      id: string; name: string; email: string; orders: bigint; gross: bigint;
      revenue: bigint; platformRevenue: bigint; pending: bigint; available: bigint; reserved: bigint; paid: bigint;
    }>>`WITH sales AS (
      SELECT instructor_id,count(*)::bigint AS orders,COALESCE(sum(amount),0)::bigint AS gross,
      COALESCE(sum(CASE WHEN status='paid' THEN instructor_amount ELSE 0 END),0)::bigint AS revenue,
      COALESCE(sum(CASE WHEN status='paid' THEN platform_amount ELSE 0 END),0)::bigint AS platform
      FROM commerce_orders WHERE status IN ('paid','refunded') AND COALESCE(settled_at,created_at)>=
      (${period.start}) AT TIME ZONE 'Asia/Ho_Chi_Minh'
      AND COALESCE(settled_at,created_at)<(${period.end}+1) AT TIME ZONE 'Asia/Ho_Chi_Minh'
      GROUP BY instructor_id
    ), balances AS (
      SELECT owner_id,
      COALESCE(sum(amount) FILTER (WHERE account='pending'),0)::bigint AS pending,
      COALESCE(sum(amount) FILTER (WHERE account='available'),0)::bigint AS available,
      COALESCE(sum(amount) FILTER (WHERE account='reserved'),0)::bigint AS reserved,
      COALESCE(sum(amount) FILTER (WHERE account='paid'),0)::bigint AS paid
      FROM commerce_entries GROUP BY owner_id
    ) SELECT u.id,u.display_name AS name,u.email::text AS email,
      COALESCE(s.orders,0)::bigint AS orders,COALESCE(s.gross,0)::bigint AS gross,
      COALESCE(s.revenue,0)::bigint AS revenue,COALESCE(s.platform,0)::bigint AS "platformRevenue",
      COALESCE(b.pending,0)::bigint AS pending,COALESCE(b.available,0)::bigint AS available,
      COALESCE(b.reserved,0)::bigint AS reserved,COALESCE(b.paid,0)::bigint AS paid
      FROM users u LEFT JOIN sales s ON s.instructor_id=u.id LEFT JOIN balances b ON b.owner_id=u.id
      WHERE u.role='lecturer' OR EXISTS (SELECT 1 FROM courses c WHERE c.instructor_id=u.id)
        OR EXISTS (SELECT 1 FROM commerce_orders o WHERE o.instructor_id=u.id)
      ORDER BY u.display_name,u.id`;
    return rows.map((row) => {
      const { id, name, email, ...amounts } = row;
      const values = Object.fromEntries(Object.entries(amounts).map(([key, value]) => {
        const amount = Number(value);
        if (!Number.isSafeInteger(amount)) throw new Error('Revenue exceeds safe integer range');
        return [key, amount];
      }));
      return { id, name, email, ...values };
    });
  }
}
