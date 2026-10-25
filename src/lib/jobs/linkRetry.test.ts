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
