import { expect, it } from 'vitest';
import { evidenceOnlyLinkFailure, linkRetryBrief } from './linkRetry';

it('repairs missing evidence without discarding a potentially valid placement', () => {
  const issues = [{ problem: 'The relevance evidence quotes nothing from the opportunity page. Include at least one exact quotation (25+ characters, in double quotes) copied from that page.' }];
  expect(evidenceOnlyLinkFailure(issues)).toBe(true);
  expect(linkRetryBrief(issues)).toContain('SAME candidate page');
  expect(linkRetryBrief(issues)).toContain('Do not invent quotations');
});
it('replaces prohibited or unavailable placements even when evidence also failed', () => {
  const issues = [{ problem: 'None of the passages quoted as evidence appear on https://example.com/.' }, { problem: 'Independent page check failed: gambling content is prohibited.' }];
  expect(evidenceOnlyLinkFailure(issues)).toBe(false);
  expect(linkRetryBrief(issues)).toContain('different eligible opportunity');
  expect(evidenceOnlyLinkFailure([])).toBe(false);
});
it('repairs incomplete recommendation fields before discarding the candidate', () => {
  const issues = ['Why now is missing.', 'Opportunity is missing.', 'Relevance score is not a valid number.',
    'No source link for this record.', 'Direct audience/topic relevance must score at least 75/100.',
    'The recommendation has no opportunity page address.'].map(problem => ({ problem }));
  expect(evidenceOnlyLinkFailure(issues)).toBe(true);
  expect(linkRetryBrief(issues)).toContain('exact required field keys');
  expect(evidenceOnlyLinkFailure([{ problem: 'Direct audience/topic relevance must score at least 75/100.' }])).toBe(false);
  expect(evidenceOnlyLinkFailure([...issues, { problem: 'Independent page check failed: affiliate sites are prohibited.' }])).toBe(false);
});
