import { summarizePricing } from './roadmap-pricing';

describe('summarizePricing', () => {
  const offers = new Map([
    ['paid-on-sale', { priceVnd: 1_799_000, listPriceVnd: 1_999_000 }],
    ['paid', { priceVnd: 499_000, listPriceVnd: 499_000 }],
    ['free', { priceVnd: 0, listPriceVnd: 0 }],
  ]);

  it('adds what a learner pays today and the list total separately', () => {
    expect(summarizePricing(['paid-on-sale', 'paid', 'free'], offers)).toEqual({
      totalVnd: 2_298_000,
      listTotalVnd: 2_498_000,
      paidCourses: 2,
      freeCourses: 1,
    });
  });

  it('counts a course with no price row as free, never as missing', () => {
    expect(summarizePricing(['no-price-row'], offers)).toEqual({
      totalVnd: 0,
      listTotalVnd: 0,
      paidCourses: 0,
      freeCourses: 1,
    });
  });

  it('is all zeroes for an empty roadmap', () => {
    expect(summarizePricing([], offers)).toEqual({ totalVnd: 0, listTotalVnd: 0, paidCourses: 0, freeCourses: 0 });
  });
});
