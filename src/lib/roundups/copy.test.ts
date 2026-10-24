import { expect, it } from 'vitest';
import { sourceRoundupCopy } from './copy';

it('keeps platform changelog bullets ahead of games when writing is unavailable', () => {
  const copy = sourceRoundupCopy('PlayBound', [
    { id: 'game', title: 'A game', url: 'https://example.com/game', description: 'A complete description of this game and what the player can do in it. ' + 'Further details '.repeat(50) },
    { id: 'github:org/site:production:sha:fixed', title: 'Platform updates — fixed', url: 'https://github.com/org/site/commits/sha', description: 'Fixed:\n- Fix mobile game filters\nEvidence: private implementation detail' },
  ]);
  expect(copy.bodyMarkdown).toContain('## Platform updates\n\n### Fixed\n\n- Fix mobile game filters');
  expect(copy.bodyMarkdown.indexOf('## Platform updates')).toBeLessThan(copy.bodyMarkdown.indexOf('## New games'));
  expect(copy.bodyMarkdown).not.toContain('private implementation detail');
  expect(copy.bodyMarkdown).toContain('what the player can do in it.');
  expect(copy.summary).toBe('1 new games, plus platform additions, improvements and fixes.');
});
