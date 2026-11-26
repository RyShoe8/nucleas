import { describe, expect, it } from 'vitest';
import { CONTENT_CASES, contentScore } from './contentCases';
describe('content evaluation scoring', () => {
  const grades = CONTENT_CASES.map(c => ({ caseId: c.id, factuality: 4, coverage: 4, voice: 4, originality: 4, criticalError: false, notes: 'Human reviewed.' }));
  it('scores completed human reviews and keeps factual failures below routing eligibility', () => {
    expect(contentScore(grades)).toBe(1);
    expect(contentScore([{ ...grades[0], criticalError: true }, ...grades.slice(1)])).toBeLessThan(0.7);
    expect(contentScore([{ ...grades[0], factuality: 2 }, ...grades.slice(1)])).toBeLessThan(0.7);
  });
});
