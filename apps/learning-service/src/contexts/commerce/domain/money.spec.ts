import {
  MAX_PRICE_VND,
  MIN_PAID_PRICE_VND,
  discountedPrice,
  listPriceViolation,
  salePriceViolation,
} from './money';

describe('listPriceViolation', () => {
  it('accepts free and every price VNPAY can charge', () => {
    for (const price of [0, MIN_PAID_PRICE_VND, 1_799_000, MAX_PRICE_VND]) {
      expect(listPriceViolation(price)).toBeNull();
    }
  });

  it('rejects paid prices the gateway would refuse at checkout', () => {
    // Before this rule 1–4.999 ₫ saved fine and every purchase then failed at VNPAY.
    for (const price of [1, 1_000, 4_999, 1_000_000_000]) {
      expect(listPriceViolation(price)).toMatch(/5\.000/);
    }
  });

  it('rejects non-integers and negatives', () => {
    expect(listPriceViolation(-1)).not.toBeNull();
    expect(listPriceViolation(10_000.5)).not.toBeNull();
  });
});

describe('salePriceViolation', () => {
  it('needs a paid course, the gateway minimum, and a real discount', () => {
    expect(salePriceViolation(5_000, 0)).toMatch(/miễn phí/);
    expect(salePriceViolation(4_000, 100_000)).toMatch(/5\.000/);
    expect(salePriceViolation(100_000, 100_000)).toMatch(/thấp hơn/);
    expect(salePriceViolation(90_000, 100_000)).toBeNull();
  });
});

describe('discountedPrice', () => {
  it('rounds down to whole thousands like the lecturer form', () => {
    expect(discountedPrice(1_999_000, 10)).toBe(1_799_000);
    expect(discountedPrice(149_000, 15)).toBe(126_000);
  });

  it('can fall below the gateway minimum, which the batch flows now refuse', () => {
    const sale = discountedPrice(10_000, 60);
    expect(sale).toBe(4_000);
    expect(salePriceViolation(sale, 10_000)).not.toBeNull();
  });
});
