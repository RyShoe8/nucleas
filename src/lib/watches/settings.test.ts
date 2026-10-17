import { describe, expect, it } from 'vitest';
import { cleanFields, cleanValues, compareByRank, fieldKey, isWatchFlagged, valueLines, watchSettings } from './settings';

describe('watch settings', () => {
  it('reads watches saved before rankings by their mode', () => {
    expect(watchSettings({ mode: 'deal', threshold: 25 })).toMatchObject({ rank: 'discount', minDiscountPct: 25, fitThreshold: 0 });
    expect(watchSettings({ mode: 'match', threshold: 70 })).toMatchObject({ rank: 'fit', fitThreshold: 70 });
    expect(watchSettings({ mode: 'deal', rank: 'newest', threshold: 40, minDiscountPct: 10 })).toMatchObject({ rank: 'newest', fitThreshold: 40, minDiscountPct: 10 });
  });

  it('keeps fields labelled, typed and unique', () => {
    expect(fieldKey('Regular price ($)')).toBe('regular_price');
    expect(cleanFields([{ label: 'Price', kind: 'money' }, { label: 'price', kind: 'text' }, { label: '' }, { label: 'Link', kind: 'weird' }, 'junk'])).toEqual([
      { key: 'price', label: 'Price', kind: 'money' },
      { key: 'link', label: 'Link', kind: 'text' },
    ]);
  });

  it('keeps only known, non-empty values', () => {
    const fields = cleanFields([{ label: 'Company' }, { label: 'Price', kind: 'money' }]);
    expect(cleanValues({ company: ' Acme ', price: 'null', extra: 'x' }, fields)).toEqual({ company: 'Acme' });
    expect(cleanValues({ price: 20 }, fields)).toEqual({ price: '20' });
    expect(valueLines({ company: 'Acme', gone: 'y' }, fields)).toEqual(['Company: Acme', 'gone: y']);
  });

  it('flags on fit, and for discount watches also on the offer', () => {
    const fit = { rank: 'fit' as const, fitThreshold: 60, minDiscountPct: 30 };
    expect(isWatchFlagged({ fit: 60, discountPct: null }, fit)).toBe(true);
    expect(isWatchFlagged({ fit: 59, discountPct: null }, fit)).toBe(false);
    const discount = { rank: 'discount' as const, fitThreshold: 50, minDiscountPct: 150 };
    expect(isWatchFlagged({ fit: null, discountPct: 300 }, discount)).toBe(true);
    expect(isWatchFlagged({ fit: 40, discountPct: 300 }, discount)).toBe(false);
    expect(isWatchFlagged({ fit: 90, discountPct: 120 }, discount)).toBe(false);
  });

  it('orders by score, or by date for newest', () => {
    const items = [{ score: 10, sentAt: '2026-10-03' }, { score: 90, sentAt: '2026-10-01' }, { score: 50, sentAt: '2026-10-02' }];
    expect([...items].sort(compareByRank('fit')).map((i) => i.score)).toEqual([90, 50, 10]);
    expect([...items].sort(compareByRank('newest')).map((i) => i.score)).toEqual([10, 50, 90]);
  });
});
