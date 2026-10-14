import type { RoadmapPricing } from '../domain/port/roadmap.repository';

/** Cộng giá các khóa của một lộ trình. Khóa chưa có dòng giá là khóa miễn phí. */
export function summarizePricing(
  courseIds: string[],
  offers: Map<string, { priceVnd: number; listPriceVnd: number }>,
): RoadmapPricing {
  return courseIds.reduce<RoadmapPricing>(
    (sum, id) => {
      const offer = offers.get(id);
      const price = offer?.priceVnd ?? 0;
      return {
        totalVnd: sum.totalVnd + price,
        listTotalVnd: sum.listTotalVnd + (offer?.listPriceVnd ?? 0),
        paidCourses: sum.paidCourses + (price > 0 ? 1 : 0),
        freeCourses: sum.freeCourses + (price > 0 ? 0 : 1),
      };
    },
    { totalVnd: 0, listTotalVnd: 0, paidCourses: 0, freeCourses: 0 },
  );
}
