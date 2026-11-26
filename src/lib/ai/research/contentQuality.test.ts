import { describe, expect, it } from 'vitest';
import { defaultCoverage, evaluateQuality, sourcePassages, type SourcePassage } from './contentQuality';
import { numericClaimWarnings, numericTokens } from './numericClaims';

const now = new Date('2026-11-25T15:00:00Z');
const sources: SourcePassage[] = [{ id: 'page-1', url: 'https://example.com/terms', text: 'Alpha advertises withdrawals within 24 hours after identity approval. Bank processing takes 3–5 working days.', checkedAt: now.toISOString(), origin: 'page' }];
const coverage = [{ id: 'timing', question: 'Explain withdrawal timing and limitations.', required: true, evidence: 'Official terms and qualifications.' }];
const review = () => ({ verdict: 'pass', notes: 'The advertised target is qualified.', allMaterialClaimsChecked: true,
  claims: [{ claim: 'Alpha advertises withdrawals within 24 hours after identity approval.', subject: 'Alpha', sourceId: 'page-1', quote: sources[0].text.split('. ')[0], scope: 'Advertised target, after identity approval; excludes bank processing.', kind: 'advertised', verdict: 'supported', reason: 'The exact terms state this qualified target.', volatile: true }],
  coverage: [{ id: 'timing', status: 'supported', reason: 'Target and exceptions explained.' }], editorial: { depth: true, originality: true, voice: true, honestExperience: true, notes: 'A useful distinction.' },
});
describe('evidence quality gates', () => {
  it('requires every human-agreed check even when the planner or reviewer omits it', () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({ key: `field_${i}`, label: `Field ${i}`, required: true }));
    const gates = Array.from({ length: 12 }, (_, i) => `Verify mandatory condition ${i + 1}.`);
    const required = defaultCoverage(fields, { gates });
    expect(required).toHaveLength(25);
    const value = review();
    value.coverage = required.map(c => ({ id: c.id, status: 'supported', reason: 'Verified against the agreed requirement.' }));
    expect(evaluateQuality(value, sources, required, { now }).status).toBe('ready');
    value.coverage = value.coverage.filter(c => c.id !== 'agreement-check-12');
    const incomplete = evaluateQuality(value, sources, required, { now });
    expect(incomplete.status).toBe('incomplete');
    expect(incomplete.issues).toContain('Required coverage missing: Verify mandatory condition 12.');
  });
  it('accepts a complete review only when the quoted original passage matches', () => {
    const result = evaluateQuality(review(), sources, coverage, { now });
    expect(result.status).toBe('ready');
    expect(result.claims[0]).toMatchObject({ quoteMatched: true, sourceUrl: sources[0].url, checkedAt: now.toISOString(), kind: 'advertised' });
  });
  it('does not trust a model claiming a fabricated quote is supported', () => {
    const value = review(); value.claims[0].quote = 'We personally tested a guaranteed 24-hour withdrawal.';
    expect(evaluateQuality(value, sources, coverage, { now }).status).toBe('incomplete');
  });
  it('rejects a changed number even if the model calls the exact quote supporting evidence', () => {
    const value = review(); value.claims[0].claim = 'Alpha advertises withdrawals within 2 hours after identity approval.';
    expect(evaluateQuality(value, sources, coverage, { now }).issues.join(' ')).toContain('number or unit');
  });
  it('verifies arithmetic without confusing currency with impressions', () => {
    const text = 'Hearth revenue this period is USD 347.37; prior period revenue is USD 300.00.';
    const value = review();
    const claims = [{ ...value.claims[0], claim: 'Revenue increased 15.79%.', quote: text, kind: 'inference', calculation: { operation: 'percent_change', inputs: [347.37, 300], result: 15.79, unit: 'percent' } }];
    const packet = [{ ...sources[0], text }];
    expect(evaluateQuality({ ...value, claims }, packet, coverage, { now }).status).toBe('ready');
    claims[0].calculation.result = 50; claims[0].claim = 'Revenue increased 50%.';
    expect(evaluateQuality({ ...value, claims }, packet, coverage, { now }).status).toBe('incomplete');
    claims[0].calculation = { operation: 'difference', inputs: [347.37, 300], result: 47.37, unit: 'USD' };
    claims[0].claim = 'Revenue increased $47.37.';
    expect(evaluateQuality({ ...value, claims }, packet, coverage, { now }).status).toBe('ready');
    const impressionText = text.replaceAll('USD', 'impressions');
    claims[0].quote = impressionText;
    expect(evaluateQuality({ ...value, claims }, [{ ...packet[0], text: impressionText }], coverage, { now }).status).toBe('incomplete');
  });
  it('keeps claim conflicts and unsupported scope visible despite an overall pass', () => {
    const value = review(); value.claims[0].verdict = 'conflicted';
    expect(evaluateQuality(value, sources, coverage, { now }).claims[0].verdict).toBe('conflicted');
  });
  it('does not reset old source freshness when it is reused', () => {
    expect(evaluateQuality(review(), [{ ...sources[0], checkedAt: '2026-11-01T00:00:00Z' }], coverage, { now }).claims[0].stale).toBe(true);
  });
  it('does not let the reviewer silently waive mandatory coverage', () => {
    const value = review(); value.coverage[0].status = 'not_applicable';
    expect(evaluateQuality(value, sources, coverage, { now }).issues.join(' ')).toContain('Required coverage');
  });
  it('does not fail useful work for optional gaps', () => {
    expect(evaluateQuality(review(), sources, [...coverage, { ...coverage[0], id: 'optional', required: false }], { now }).status).toBe('ready');
  });
  it('flags unassessed claims, invented experience and superficial editing', () => {
    const value = review(); value.allMaterialClaimsChecked = false; value.editorial.honestExperience = false; value.editorial.originality = false;
    expect(evaluateQuality(value, sources, coverage, { now }).issues).toHaveLength(3);
  });
  it('retains an explicit failure for an unreadable review, including empty JSON', () => {
    for (const raw of [null, '{}', 'not JSON']) expect(evaluateQuality(raw, sources, coverage).status).toBe('review_failed');
  });
  it('does not accept an empty claim inventory for a sourced deliverable', () => {
    const value = review(); value.claims = [];
    expect(evaluateQuality(value, sources, coverage, { now }).status).toBe('incomplete');
  });
  it('retrieves relevant passages beyond navigation and bounds the total evidence size', () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/${i}`, status: 'opened' as const, text: 'Navigation links. '.repeat(400) + 'Identity approval and bank processing withdrawal qualifications. '.repeat(10) }));
    const found = sourcePassages(pages, 'Identity approval and bank processing withdrawal qualifications', now);
    expect(found[0].text).toContain('Identity approval');
    expect(found.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(30_000);
    expect(sourcePassages([{ url: 'https://example.com', status: 'blocked', text: 'Not evidence' }], '', now)).toEqual([]);
  });
});
describe('numeric review screening', () => {
  it('includes small quantities, percentages, years and currency units', () => {
    expect(numericTokens('Two users: 2 users. In 2026, $5 and 5% are different.')).toEqual(expect.arrayContaining(['2 user', '2026', '$5', '5%']));
  });
  it('flags a company swap and does not treat impressions as money', () => {
    expect(numericClaimWarnings('Hearth revenue was $347.37.', ['Frugal Gambler impressions were 347.37.'])).toHaveLength(1);
    expect(numericClaimWarnings('Hearth revenue was $347.37.', ['Hearth revenue was $347.37.'])).toEqual([]);
  });
  it('sends derived figures to review instead of calling them false', () => {
    expect(numericClaimWarnings('Revenue increased 15.79%.', ['Revenue was $347.37 versus $300.'])).toHaveLength(1);
  });
});
