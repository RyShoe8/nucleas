import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/companies/companyProfile', () => ({ isCompanyManager: () => true, getCompanyProfile: async (_v: unknown, id: string) => (id === 'c'.repeat(24) ? { id, name: 'Frugal Gambler' } : null) }));
vi.mock('@/lib/companies/upstreamContext', () => ({ upstreamContext: async () => 'Approved Marketing Plan:\n- Positioning: honest casino deal hunting' }));
vi.mock('@/lib/ai/engine/ask', () => ({ askEngine: async () => null }));

import { designWatch, fallbackDesign, parseDesign } from './design';

const viewer = { userId: 'u'.repeat(24), organizationId: 'o'.repeat(24), employeeId: null, role: 'Manager' as const } as never;

describe('designing a watch from a sentence', () => {
  it('bounds what the model proposes', () => {
    const design = parseDesign({ name: 'Casino deals', description: 'Promotional emails from sweepstakes casinos.', noun: 'Deal', fields: [{ label: 'Casino' }, { label: 'Price', kind: 'money' }], rank: 'discount', threshold: 140, min_discount_pct: 5000, units: ['SC', 'GC', 7] });
    expect(design).toMatchObject({ noun: 'deal', rank: 'discount', threshold: 100, minDiscountPct: 1000, dealUnitTokens: ['SC', 'GC'], fields: [{ key: 'casino' }, { key: 'price', kind: 'money' }] });
    expect(parseDesign({ name: 'x', description: 'y', fields: [] })).toBeNull();
    expect(parseDesign({ name: 'News', description: 'AI news', fields: [{ label: 'Headline' }], rank: 'sideways', units: ['SC'] })).toMatchObject({ rank: 'fit', dealUnitTokens: [] });
  });

  it('falls back to a starting point that fits the wording', () => {
    expect(fallbackDesign('the biggest discounts on camping gear')).toMatchObject({ rank: 'discount', noun: 'deal' });
    expect(fallbackDesign('AI industry news for a weekly newsletter')).toMatchObject({ rank: 'fit', noun: 'story' });
    expect(fallbackDesign('new game releases and trailers')).toMatchObject({ noun: 'release' });
  });

  it('gives the model the company\'s upstream plans as context', async () => {
    let seen = '';
    const ask = async ({ user }: { system: string; user: string }) => {
      seen = user;
      return JSON.stringify({ name: 'Casino deals', description: 'Casino promos', noun: 'deal', fields: [{ label: 'Casino' }], rank: 'discount', threshold: 50, min_discount_pct: 40, units: ['SC'] });
    };
    const result = await designWatch(viewer, { request: 'Collect the best casino deals', companyId: 'c'.repeat(24) }, ask);
    expect(result).toMatchObject({ ok: true, design: { designed: true, rank: 'discount', minDiscountPct: 40 } });
    expect(seen).toContain('honest casino deal hunting');
    expect(seen).toContain('Frugal Gambler');
  });

  it('uses the fallback when no model answers, and refuses an unknown company', async () => {
    expect(await designWatch(viewer, { request: 'AI industry news' }, async () => null)).toMatchObject({ ok: true, design: { designed: false, noun: 'story' } });
    expect(await designWatch(viewer, { request: 'AI industry news', companyId: 'd'.repeat(24) })).toMatchObject({ ok: false, status: 404 });
    expect(await designWatch(viewer, { request: 'hi' })).toMatchObject({ ok: false, status: 400 });
  });
});
