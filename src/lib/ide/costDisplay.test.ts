import { describe, expect, it } from 'vitest';
import { formatIdeCostUsd } from '@/lib/ide/costDisplay';
import { isIdeChatMode, normalizeIdeChatMode, taskRuleModeQueryValues } from '@/lib/ide/modes';

describe('ide modes', () => {
  it('maps every legacy AI Team and Plan/Build/Research tab to Orchestrated', () => {
    for (const legacy of ['product', 'engineering', 'researcher', 'marketing', 'support', 'plan', 'build', 'research']) {
      expect(isIdeChatMode(legacy)).toBe(false);
      expect(normalizeIdeChatMode(legacy)).toBe('orchestrated');
    }
    expect(normalizeIdeChatMode('nonsense')).toBeNull();
  });

  it('applies rules saved under legacy tabs to Orchestrated, never to Direct', () => {
    expect(taskRuleModeQueryValues('orchestrated')).toEqual(expect.arrayContaining(['all', 'orchestrated', 'engineering', 'plan']));
    expect(taskRuleModeQueryValues('direct')).toEqual(['all', 'direct']);
  });
});

describe('formatIdeCostUsd', () => {
  it('shows zero with no-provider-fee cue', () => {
    expect(formatIdeCostUsd({ costMicros: null, reservedMicros: 25, noProviderFee: true })).toEqual({
      label: 'no provider fee',
      amount: '$0.00',
    });
  });

  it('prefers token-estimated cost', () => {
    expect(formatIdeCostUsd({ costMicros: 1_500_000, reservedMicros: 2_000_000, noProviderFee: false })).toEqual({
      label: 'estimated',
      amount: '~$1.5',
    });
  });

  it('falls back to budget hold when settled unknown', () => {
    expect(formatIdeCostUsd({ costMicros: null, reservedMicros: 250_000, noProviderFee: false })).toEqual({
      label: 'budget hold',
      amount: '$0.25',
    });
  });
});
