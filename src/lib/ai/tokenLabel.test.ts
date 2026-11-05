import { expect, it } from 'vitest';
import { tokenDetail, tokenLabel } from './tokenLabel';

it('shortens large counts', () => {
  expect(tokenLabel({ inputTokens: 900, outputTokens: 34 , unknownTokenRuns: 0 })).toBe('934 tokens');
  expect(tokenLabel({ inputTokens: 1_200_000, outputTokens: 300_000, unknownTokenRuns: 0 })).toBe('1.5M tokens');
});

it('never shows unreported usage as zero', () => {
  expect(tokenLabel({ inputTokens: 0, outputTokens: 0, unknownTokenRuns: 3 })).toBe('Not reported');
  expect(tokenLabel({ inputTokens: 1500, outputTokens: 0, unknownTokenRuns: 3 })).toBe('1.5K+ tokens');
  expect(tokenLabel({ inputTokens: 0, outputTokens: 0, unknownTokenRuns: 0 })).toBe('0 tokens');
});

it('gives the exact split on hover', () => {
  expect(tokenDetail({ inputTokens: 1200, outputTokens: 34, unknownTokenRuns: 0 })).toBe('1,200 in · 34 out');
  expect(tokenDetail({ inputTokens: 1200, outputTokens: 34, unknownTokenRuns: 2 })).toBe('1,200 in · 34 out · 2 run(s) did not report tokens');
});
