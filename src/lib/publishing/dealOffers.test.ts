import { describe, expect, it } from 'vitest';
import { offersInEmail } from '@/lib/watches/dealMetrics';
import type { DealMetrics } from '@/lib/watches/types';
import { dealForKey, emailOffers, sourceItemId } from './dealOffers';

const ID = 'a'.repeat(24);
const deal = (pay: number, credit: number, unit = 'SC') => ({ mode: 'pay_vs_credited_value', you_pay: pay, baseline_value: credit, pay_unit: 'USD', credit_unit: unit, units_comparable: false, effective_savings_pct: 0, bonus_pct: credit / pay - 1, confidence: 0.9, source: 'llm' }) as DealMetrics;
const partial = (pay: number, credit: number, confidence = 0.9, unit = 'SC') => ({ you_pay: pay, baseline_value: credit, pay_unit: 'USD', credit_unit: unit, mode: 'pay_vs_credited_value' as const, confidence });
const best = deal(50, 63);
const small = deal(25, 30);

describe('splitting an email into one deal per package', () => {
  it('gives each package its own key and keeps the email id on the best one', () => {
    expect(emailOffers({ _id: ID, bestDeal: best, offers: [small, best] })).toEqual([
      { key: ID, deal: best },
      { key: `${ID}~25-30-sc-pay_vs_credited_value`, deal: small },
    ]);
  });

  it('leaves an email with one offer, or scanned before packages were recorded, as one deal', () => {
    expect(emailOffers({ _id: ID, bestDeal: best, offers: [best] })).toEqual([{ key: ID, deal: best }]);
    expect(emailOffers({ _id: ID, bestDeal: best })).toEqual([{ key: ID, deal: best }]);
    expect(emailOffers({ _id: ID })).toEqual([{ key: ID, deal: null }]);
  });

  it('judges each package against the minimum on its own', () => {
    expect(emailOffers({ _id: ID, bestDeal: best, offers: [small, best] }, 25).map((offer) => offer.deal)).toEqual([best]);
    expect(emailOffers({ _id: ID, bestDeal: best, offers: [deal(25, 25), best] }).map((offer) => offer.deal)).toEqual([best]);
  });

  it('caps how many deals one email can make', () => {
    const offers = [10, 20, 30, 40, 50, 60, 70].map((pay) => deal(pay, pay * 1.5));
    expect(emailOffers({ _id: ID, bestDeal: offers[0], offers })).toHaveLength(5);
  });

  it('finds the email and the deal again from a key', () => {
    const [, second] = emailOffers({ _id: ID, bestDeal: best, offers: [small, best] });
    expect(sourceItemId(second!.key)).toBe(ID);
    expect(sourceItemId(ID)).toBe(ID);
    expect(dealForKey({ bestDeal: best, offers: [small, best] }, second!.key)).toEqual(small);
    expect(dealForKey({ bestDeal: best, offers: [small, best] }, ID)).toEqual(best);
    expect(dealForKey({ bestDeal: best }, `${ID}~gone`)).toEqual(best);
  });

  it('never treats a page URL as an email key', () => {
    expect(sourceItemId('https://example.com/~name/page')).toBe('https://example.com/~name/page');
  });
});

describe('reading the packages in an email', () => {
  const text = 'Winfinite Wednesday! Buy $25 and get 30 SC, or buy $50 and get 63 SC.';

  it('adds other packages the model read when the email shows their amounts', () => {
    expect(offersInEmail(best, [], [partial(25, 30)], text).map((offer) => [offer.you_pay, offer.baseline_value])).toEqual([[50, 63], [25, 30]]);
  });

  it('refuses a package whose amounts are not in the email', () => {
    expect(offersInEmail(best, [], [partial(100, 130)], text)).toEqual([best]);
    expect(offersInEmail(best, [], [partial(5, 3)], text)).toEqual([best]);
  });

  it('refuses low confidence, another unit, and a second reading of the same price', () => {
    expect(offersInEmail(best, [], [partial(25, 30, 0.2)], text)).toEqual([best]);
    expect(offersInEmail(best, [], [partial(25, 30, 0.9, 'GC')], text)).toEqual([best]);
    expect(offersInEmail(best, [], [partial(50, 30)], text)).toEqual([best]);
  });

  it('reads amounts written with commas', () => {
    expect(offersInEmail(deal(1000, 1200), [], [partial(2500, 3500)], 'Buy $1,000 get 1,200 SC or $2,500 get 3,500 SC')).toHaveLength(2);
  });

  it('uses the pattern reading only when it found a real list', () => {
    expect(offersInEmail(best, [small], [], text)).toEqual([best]);
    expect(offersInEmail(best, [best, small], [], text)).toEqual([best, small]);
  });

  it('has nothing to split without a deal', () => {
    expect(offersInEmail(null, [small, best], [partial(25, 30)], text)).toEqual([]);
  });
});
