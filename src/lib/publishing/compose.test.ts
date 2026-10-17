import { describe, expect, it, vi } from 'vitest';
import { charCount, composePost, composeSystemPrompt, composeUserPrompt, fitToLimit, parseDraft } from './compose';
import { extractPageFacts } from './pageFacts';

const base = { companyName: 'PlayBound', persona: 'Warm, nerdy, plain-spoken. Short sentences.', brief: 'Post every new game', noun: 'game', facts: { title: 'Deus Ex', description: 'Online co-op is back.' }, link: 'https://playbound.club/games/deus-ex' };

describe('prompts', () => {
  it('puts the Voice, the example as structure only, and the platform rules in the system prompt', () => {
    const system = composeSystemPrompt({ ...base, platform: 'reddit', example: 'Title: New Game Release: X\n\nWhat it is...', subreddit: 'PlayBoundGaming' });
    expect(system).toContain('Warm, nerdy');
    expect(system).toContain('structure');
    expect(system).toContain('Do not copy its wording');
    expect(system).toContain('r/PlayBoundGaming');
    expect(system).toContain('{"title": "...", "body": "..."}');
    expect(composeSystemPrompt({ ...base, platform: 'bluesky', example: '' })).not.toContain('EXAMPLE POST');
  });

  it('gives the facts, video and link as data', () => {
    const user = composeUserPrompt({ noun: 'game', facts: { title: 'Deus Ex', description: 'Co-op', video: 'https://www.youtube.com/watch?v=abc123', text: 'Long page text' }, link: 'https://x.com/g' });
    expect(user).toMatch(/Name: Deus Ex[\s\S]*Trailer or video: https:\/\/www\.youtube\.com[\s\S]*Link: https:\/\/x\.com\/g[\s\S]*Long page text/);
  });
});

describe('parsing drafts', () => {
  it('reads JSON, strips markdown outside Reddit and requires a Reddit title', () => {
    expect(parseDraft('bluesky', '```json\n{"body": "**New:** Deus Ex co-op"}\n```')).toEqual({ title: null, body: 'New: Deus Ex co-op' });
    expect(parseDraft('reddit', '{"title": "New Game Release: Deus Ex", "body": "**Co-op** is back"}')).toEqual({ title: 'New Game Release: Deus Ex', body: '**Co-op** is back' });
    expect(parseDraft('reddit', '{"body": "no title"}')).toBeNull();
    expect(parseDraft('facebook', null)).toBeNull();
  });

  it('counts emoji as one character and trims at a word', () => {
    expect(charCount('hi 👋🏽')).toBe(4);
    const long = 'word '.repeat(100).trim();
    const fitted = fitToLimit(long, 300);
    expect(charCount(fitted)).toBeLessThanOrEqual(300);
    expect(fitted.endsWith('word…')).toBe(true);
  });

  it('asks once more when the first draft is over the limit', async () => {
    const write = vi.fn().mockResolvedValueOnce(JSON.stringify({ body: 'x'.repeat(400) })).mockResolvedValueOnce(JSON.stringify({ body: 'Short and sweet.' }));
    const draft = await composePost({ ...base, platform: 'bluesky', example: '' }, write);
    expect(draft).toEqual({ title: null, body: 'Short and sweet.' });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![0].user).toContain('under 300 characters');
  });
});

describe('page facts', () => {
  it('reads share tags, content images, and the trailer embed', () => {
    const html = `<html><head><title>Fallback</title>
      <meta property="og:title" content="Deus Ex &amp; Friends">
      <meta name="description" content="Online co-op">
      <meta property="og:image" content="/img/cover.jpg"></head>
      <body><nav>Menu</nav><main><h1>Deus Ex</h1><p>Play together.</p>
      <img src="/img/logo.png"><img src="https://cdn.playbound.club/shot1.jpg"><img src="/img/cover.jpg">
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><script>evil()</script></main></body></html>`;
    const facts = extractPageFacts(html, 'https://playbound.club/games/deus-ex');
    expect(facts).toMatchObject({
      title: 'Deus Ex & Friends',
      description: 'Online co-op',
      image: 'https://playbound.club/img/cover.jpg',
      images: ['https://cdn.playbound.club/shot1.jpg'],
      video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(facts.text).toContain('Play together.');
    expect(facts.text).not.toContain('evil');
  });

  it('drops images that point at private addresses', () => {
    const facts = extractPageFacts('<meta property="og:image" content="https://127.0.0.1/a.png"><main><img src="https://10.0.0.5/b.jpg"></main>', 'https://a.com/x');
    expect(facts.image).toBeNull();
    expect(facts.images).toEqual([]);
  });
});
