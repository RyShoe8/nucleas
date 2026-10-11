import { describe, expect, it } from 'vitest';
import { isRedditRecord, redditPostFromRecord, subredditSubmitUrl } from './redditPost';

describe('redditPostFromRecord', () => {
  it('uses the explicit title and the copy as the body', () => {
    expect(redditPostFromRecord({ platform: 'Reddit', post_title: 'Is a bankroll tracker worth it?', post_copy: 'Here is what I found.\n\nLink in comments.' })).toEqual({
      title: 'Is a bankroll tracker worth it?',
      body: 'Here is what I found.\n\nLink in comments.',
      combined: 'Is a bankroll tracker worth it?\n\nHere is what I found.\n\nLink in comments.',
    });
  });

  it('falls back to the first line of the copy as the title', () => {
    const post = redditPostFromRecord({ platform: 'reddit (r/Foo)', post_copy: '## My title\n\nBody text here.' });
    expect(post).toMatchObject({ title: 'My title', body: 'Body text here.' });
  });

  it('caps the title at 300 characters', () => {
    const post = redditPostFromRecord({ platform: 'Reddit', post_title: 'a'.repeat(500), post_copy: 'x' });
    expect(post?.title).toHaveLength(300);
  });

  it('ignores other platforms and empty copy', () => {
    expect(isRedditRecord({ platform: 'Bluesky' })).toBe(false);
    expect(redditPostFromRecord({ platform: 'Bluesky', post_copy: 'hi' })).toBeNull();
    expect(redditPostFromRecord({ platform: 'Reddit', post_copy: '  ' })).toBeNull();
  });

  it('builds the submit page url', () => {
    expect(subredditSubmitUrl('PlayBound')).toBe('https://www.reddit.com/r/PlayBound/submit');
  });
});
