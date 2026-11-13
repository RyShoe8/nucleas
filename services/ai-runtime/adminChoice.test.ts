import { describe, expect, it } from 'vitest';
import { noChoiceReason, uniqueChoiceLabel } from './adminForms';

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

describe('a casino named a little differently on the site', () => {
  it('finds the one casino whatever is added to or left off its name', () => {
    expect(uniqueChoiceLabel(['Stackr.com'], 'Stackr', 'Casino')).toBe('Stackr.com');
    expect(uniqueChoiceLabel(['Stackr'], 'Stackr.us', 'Casino *')).toBe('Stackr');
    expect(uniqueChoiceLabel(['The Money Factory'], 'Money Factory Casino', 'Casino')).toBe('The Money Factory');
    expect(uniqueChoiceLabel(['Crown Coins Casino (Draft)'], 'Crown Coins', 'Casino')).toBe('Crown Coins Casino (Draft)');
    expect(uniqueChoiceLabel(['Hello Millions - hellomillions.com'], 'Hello Millions', 'Casino')).toBe('Hello Millions - hellomillions.com');
    expect(uniqueChoiceLabel(['Lucky & Wild'], 'Lucky and Wild', 'Casino')).toBe('Lucky & Wild');
    expect(uniqueChoiceLabel(['  Stackr\n  '], 'stackr', 'Casino')).toBe('Stackr');
  });

  it('prefers the exact name, and never guesses between two that are only similar', () => {
    expect(uniqueChoiceLabel(['Stackr', 'Stackr.com', 'Stackr Casino'], 'Stackr', 'Casino')).toBe('Stackr');
    expect(uniqueChoiceLabel(['Stackr.com', 'Stackr.us'], 'Stackr', 'Casino')).toBeUndefined();
    expect(uniqueChoiceLabel(['Stackr (Draft)', 'Stackr (Old)'], 'Stackr', 'Casino')).toBeUndefined();
    expect(uniqueChoiceLabel(['Stackr Rewards', 'Stackr Sports'], 'Stackr', 'Casino')).toBeUndefined();
    expect(uniqueChoiceLabel(['Stack'], 'Stackr', 'Casino')).toBeUndefined();
  });

  it('removes a list decoration for any field, but only matches by brand for a casino', () => {
    expect(uniqueChoiceLabel(['Published (default)'], 'Published', 'Status')).toBe('Published (default)');
    expect(uniqueChoiceLabel(['Stackr.com'], 'Stackr', 'Campaign')).toBeUndefined();
  });

  it('says what it looked for and what the site offered', () => {
    expect(noChoiceReason([], 'Stackr', 'Casino *')).toBe('The site has no "Stackr" in its Casino list. Add it on the site first, or correct the name.');
    expect(noChoiceReason(['Stackr.com', 'Stackr.us'], 'Stackr', 'Casino')).toContain('lists "Stackr" more than once (Stackr.com; Stackr.us)');
    expect(noChoiceReason(['Stake.us', 'Stackr Rewards'], 'Stackr', 'Casino')).toBe('The site has no "Stackr". The closest it offered: Stake.us; Stackr Rewards.');
  });
});
