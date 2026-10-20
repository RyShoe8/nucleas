import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cleanEmailText, dealScore, detectKeywords, effectiveLookbackHours, gmailQueryFor, isFlagged, keywordMatchScore, prefilter, relevanceScore, sendersMatch } from './scan';
import { buildDealMetricsFromAmounts } from './dealMetrics';
import { expandKeyPoints, extractKeyPointsFallback, parseKeyPoints } from './keyPoints';
import { isNonDealUrl, pickDealLink } from './dealLink';

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

describe('gmailQueryFor', () => {
  it('ANDs a date window with label and sender clauses', () => {
    const q = gmailQueryFor({ labels: ['Promos', 'Big Deals'], senderAddresses: ['a@x.com'], senderDomains: ['@y.com'] }, 48, NOW);
    expect(q).toBe('after:2026/10/10 (label:Promos OR label:"Big Deals") (from:a@x.com OR from:y.com)');
  });

  it('is just the date window when nothing else is set', () => {
    expect(gmailQueryFor({ labels: [], senderAddresses: [], senderDomains: [] }, 24, NOW)).toBe('after:2026/10/11');
  });
});

describe('effectiveLookbackHours', () => {
  it('looks back no further than the time since the last scan, but at least the minimum gap', () => {
    expect(effectiveLookbackHours(168, null, 2, NOW)).toBe(168);
    expect(effectiveLookbackHours(168, new Date(NOW - 10 * 3600_000), 2, NOW)).toBeCloseTo(10);
    expect(effectiveLookbackHours(168, new Date(NOW - 10 * 60_000), 2, NOW)).toBe(2);
    expect(effectiveLookbackHours(6, new Date(NOW - 100 * 3600_000), 2, NOW)).toBe(6);
  });
});

describe('cleanEmailText', () => {
  it('cuts the unsubscribe footer and image links but keeps the body', () => {
    const body = `${'Big news about the new launch. '.repeat(20)}\n[https://cdn.example.com/banner.png]\nUnsubscribe here. Manage your preferences. All rights reserved.`;
    const text = cleanEmailText({ bodyText: body, bodyHtml: '' });
    expect(text).toContain('Big news about the new launch.');
    expect(text).not.toMatch(/unsubscribe|banner\.png/i);
  });

  it('falls back to the html when there is no text part', () => {
    const text = cleanEmailText({ bodyText: '', bodyHtml: '<html><style>p{color:red}</style><p>Hello <b>there</b></p><script>x()</script></html>' });
    expect(text).toBe('Hello there');
  });
});

describe('prefilter', () => {
  const base = { subject: 'Weekly', fromEmail: 'news@example.com', text: 'x'.repeat(200) };
  it('rejects short bodies, other senders and emails without a keyword', () => {
    expect(prefilter({ ...base, text: 'tiny' }, { keywords: [], senderAddresses: [], senderDomains: [] })).toEqual({ ok: false, reason: 'body_too_short:4' });
    expect(prefilter(base, { keywords: [], senderAddresses: [], senderDomains: ['other.com'] })).toEqual({ ok: false, reason: 'sender_filter_mismatch' });
    expect(prefilter(base, { keywords: ['sale'], senderAddresses: [], senderDomains: [] })).toEqual({ ok: false, reason: 'keyword_no_match' });
  });

  it('accepts a matching email', () => {
    expect(prefilter({ ...base, subject: 'Summer SALE' }, { keywords: ['sale'], senderAddresses: [], senderDomains: ['example.com'] })).toEqual({ ok: true });
  });
});

describe('sender and keyword matching', () => {
  it('matches addresses and domains, or everything when none are set', () => {
    expect(sendersMatch('a@news.example.com', { senderAddresses: [], senderDomains: ['example.com'] })).toBe(true);
    expect(sendersMatch('a@elsewhere.com', { senderAddresses: ['a@example.com'], senderDomains: [] })).toBe(false);
    expect(sendersMatch('anyone@anywhere.org', { senderAddresses: [], senderDomains: [] })).toBe(true);
  });

  it('finds keywords case-insensitively and scores by the share found', () => {
    expect(detectKeywords('Big SALE today', ['sale', 'coupon'])).toEqual(['sale']);
    expect(keywordMatchScore('Big SALE today', ['sale', 'coupon'])).toMatchObject({ score: 50 });
    expect(keywordMatchScore('nothing', [])).toMatchObject({ score: 0 });
  });
});

describe('relevanceScore', () => {
  it('rises with keywords and falls with age; promo wording only counts for deal watches', () => {
    const fresh = relevanceScore('sale sale sale bonus promo', ['sale'], NOW, 'deal', NOW);
    const stale = relevanceScore('sale sale sale bonus promo', ['sale'], NOW - 60 * 86400_000, 'deal', NOW);
    expect(fresh).toBeGreaterThan(stale);
    expect(relevanceScore('bonus promo limited time', ['x'], NOW, 'match', NOW)).toBeLessThan(relevanceScore('bonus promo limited time', ['x'], NOW, 'deal', NOW));
    expect(fresh).toBeLessThanOrEqual(10);
  });
});

describe('flagging', () => {
  it('flags at or above the threshold', () => {
    expect(isFlagged(60, 60)).toBe(true);
    expect(isFlagged(59, 60)).toBe(false);
  });

  it('scores a deal by its strength percent: the larger of the savings and the bonus, not capped at 100', () => {
    // $25 for $100 is 75% off but a 300% bonus: the larger counts, so big bonuses still rank above small ones.
    expect(dealScore(buildDealMetricsFromAmounts(25, 100, 'retail_list_vs_sale', 0.55, 'regex', 'USD', 'USD'))).toBe(300);
    expect(dealScore(buildDealMetricsFromAmounts(20, 26, 'pay_vs_credited_value', 0.5, 'regex', 'USD', 'SC'))).toBe(30);
    expect(dealScore(null)).toBe(0);
  });
});

describe('key points', () => {
  it('splits compound bullets and ignores empty or unknown categories', () => {
    expect(expandKeyPoints([{ category: 'offer', text: 'Free shipping over $50; 20% off sitewide' }]).map((p) => p.text)).toEqual(['Free shipping over $50', '20% off sitewide']);
    expect(parseKeyPoints([{ category: 'nonsense', text: 'Ends Friday at midnight' }, '', { text: '' }])).toEqual([{ category: 'other', text: 'Ends Friday at midnight' }]);
  });

  it('finds deadlines with patterns alone', () => {
    const points = extractKeyPointsFallback('Valid until October 31 at midnight. No purchase necessary.');
    expect(points.some((p) => p.category === 'deadline')).toBe(true);
    expect(points.some((p) => p.category === 'terms')).toBe(true);
  });
});

describe('the main link', () => {
  it('rejects compressed tracking destinations that point to unsubscribe without visiting them', () => {
    const payload = deflateSync(Buffer.from('https://example.com/unsubscribe')) .toString('base64url');
    const bad = `https://cdn.uk.exponea.com/brand/e/.${payload}.signature/click`;
    const good = 'https://brand.onelink.me/offer';
    expect(pickDealLink([bad], { html: `<a href="${good}">LET'S ROLL!</a><a href="${bad}">click here</a>`, subject: 'Offer' })).toBe(good);
    expect(pickDealLink([bad], { subject: 'Offer' })).toBeNull();
  });
  it('rejects opaque unsubscribe anchors even when the raw URL appears again', () => {
    const bad = 'https://track.example.com/click/opaque';
    const good = 'https://brand.example.com/buy';
    const html = `<a href="${good}">LET'S ROLL!</a><a href="${bad}">Unsubscribe</a>`;
    expect(pickDealLink([bad], { html, subject: 'Deal' })).toBe(good);
  });
  it('decodes HTML entities without changing signed tracking tokens', () => {
    expect(pickDealLink([], { html: '<a href="https://shop.example.com/buy?a=1&amp;b=2">Get Deal</a>' })).toBe('https://shop.example.com/buy?a=1&b=2');
  });
  it('prefers the call-to-action over unsubscribe, social and asset links', () => {
    const html = '<a href="https://example.com/unsubscribe">Unsubscribe</a><a href="https://twitter.com/x">X</a><a href="https://cdn.example.com/hero.png">img</a><a href="https://shop.example.com/claim-offer">Claim now</a>';
    expect(pickDealLink([], { html, subject: 'Offer', from: 'Shop <hi@example.com>' })).toBe('https://shop.example.com/claim-offer');
    expect(isNonDealUrl('https://cdn.example.com/hero.png')).toBe(true);
  });
});
