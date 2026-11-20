import { expect, it } from 'vitest';
import { preserveCandidateEvidence } from './researchRecovery';
import type { JobRunOutput } from './schema';
const now = Date.parse('2026-11-20T15:00:00Z');
const output = (values: Record<string, unknown>, sources: string[] = []): JobRunOutput => ({ records: [{ values, sources }], summary: 'Research', gaps: [] });
const before = output({ website: 'https://plausible.io/', company: 'Plausible', team_size: 11, email: 'hello@plausible.io',
  growth_source: 'https://plausible.io/changelog', growth_date: '2026-11-02', growth_quote: 'A new release', cta_url: 'https://plausible.io/register' }, ['https://plausible.io/changelog']);
it('keeps existing fields and recent growth when a retry supplies omissions and an old milestone', () => {
  const next = output({ website: 'https://plausible.io', email: null, growth_source: 'https://plausible.io/about', growth_date: '2022-06-22', growth_quote: '$1M ARR' }, ['https://plausible.io/register']);
  const merged = preserveCandidateEvidence(before, next, now);
  expect(merged.records[0]).toMatchObject({ values: { ...before.records[0].values, website: 'https://plausible.io' }, sources: ['https://plausible.io/changelog', 'https://plausible.io/register'] });
  expect(next.records[0].values.growth_date).toBe('2022-06-22');
});
it('does not invent evidence or carry fields between different prospects', () => {
  const other = output({ website: 'https://another.test/', company: 'Another' });
  expect(preserveCandidateEvidence(before, other, now)).toBe(other);
  expect(preserveCandidateEvidence(before, output({ company: 'Plausible' }), now)).toBe(before);
  const fixed = preserveCandidateEvidence(before, output({ website: 'https://plausible.io', growth_source: 'https://plausible.io/new', growth_date: '2026-11-19' }), now);
  expect(fixed.records[0].values.growth_quote).toBeUndefined();
  expect(fixed.records[0].sources).not.toContain('https://plausible.io/new');
});
