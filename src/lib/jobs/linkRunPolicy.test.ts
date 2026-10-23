import { expect, it } from 'vitest';
import { affordableLinkReview, LINK_WORK_CALLS } from './linkRunPolicy';
it('allows free checks, rejects unknown or expensive paid reviews, and respects remaining allowance', () => {
  expect(LINK_WORK_CALLS).toBe(2);
  expect(affordableLinkReview({ free: true, blendedPricePer1M: null }, 'x'.repeat(50000), 0)).toBe(true);
  expect(affordableLinkReview({ free: false, blendedPricePer1M: null }, 'Short review')).toBe(false);
  expect(affordableLinkReview({ free: false, blendedPricePer1M: 10 }, 'x'.repeat(8000))).toBe(false);
  expect(affordableLinkReview({ free: false, blendedPricePer1M: 0.1 }, 'x'.repeat(8000))).toBe(true);
  expect(affordableLinkReview({ free: false, blendedPricePer1M: 0.1 }, 'x'.repeat(8000), 100)).toBe(false);
});
