import { expect, it } from 'vitest';
import { stepText } from './modelPath';

it('keeps a step\'s whole text, however long a normal reply gets', () => {
  const text = 'word '.repeat(2000);
  expect(stepText(text)).toBe(text);
});

it('says so when a runaway reply had to be shortened', () => {
  const shortened = stepText('x'.repeat(50_000));
  expect(shortened.length).toBeLessThan(12_100);
  expect(shortened).toContain('shortened: over 12,000 characters');
});
