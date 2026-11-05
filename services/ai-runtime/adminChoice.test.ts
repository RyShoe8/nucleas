import { describe, expect, it } from 'vitest';
import { uniqueChoiceLabel } from './adminForms';

describe('casino admin choice', () => {
  it('resolves a unique casino suffix and prefers an exact label', () => {
    expect(uniqueChoiceLabel(['Stackr Casino'], 'Stackr', 'Casino')).toBe('Stackr Casino');
    expect(uniqueChoiceLabel(['Stackr Casino', 'Stackr'], 'Stackr', 'Casino')).toBe('Stackr');
  });
  it('refuses ambiguous, partial and unrelated choices', () => {
    expect(uniqueChoiceLabel(['Stackr Casino', 'Stackr Casinos'], 'Stackr', 'Casino')).toBeUndefined();
    expect(uniqueChoiceLabel(['Stackr Rewards'], 'Stackr', 'Casino')).toBeUndefined();
    expect(uniqueChoiceLabel(['Stackr Casino'], 'Stackr', 'Campaign')).toBeUndefined();
  });
});
