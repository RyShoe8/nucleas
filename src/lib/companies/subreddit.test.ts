import { describe, expect, it } from 'vitest';
import { normalizeSubreddit, subredditUrl } from './subreddit';

describe('normalizeSubreddit', () => {
  it.each([
    ['TheFrugalGambler', 'TheFrugalGambler'],
    ['r/TheFrugalGambler', 'TheFrugalGambler'],
    ['/r/TheFrugalGambler/', 'TheFrugalGambler'],
    ['https://www.reddit.com/r/TheFrugalGambler/comments/abc/some_post/', 'TheFrugalGambler'],
    ['old.reddit.com/r/TheFrugalGambler', 'TheFrugalGambler'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeSubreddit(input)).toEqual({ ok: true, subreddit: expected });
  });

  it('treats blank as clearing the subreddit', () => {
    expect(normalizeSubreddit('  ')).toEqual({ ok: true, subreddit: null });
  });

  it.each(['u/someone', 'https://reddit.com/user/someone', 'https://evil.example/r/ThingHere', 'r/ab', 'r/has space', 'r/bad-name!', 'https://reddit.com/'])('rejects %s', (input) => {
    expect(normalizeSubreddit(input).ok).toBe(false);
  });

  it('builds the community url', () => {
    expect(subredditUrl('PlayBound')).toBe('https://www.reddit.com/r/PlayBound');
  });
});
