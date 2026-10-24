import { manualPostText, fallbackSocialDraft } from './compose';
import { describe, expect, it, vi } from 'vitest';
import { charCount, composePost, composeSystemPrompt, composeUserPrompt, fitToLimit, newItemTitle, parseDraft, relabelNewItemTitle } from './compose';
import { extractPageFacts } from './pageFacts';

const base = { companyName: 'PlayBound', persona: 'Warm, nerdy, plain-spoken. Short sentences.', brief: 'Post every new game', noun: 'game', facts: { title: 'Deus Ex', description: 'Online co-op is back.' }, link: 'https://playbound.club/games/deus-ex' };

it('uses complete gameplay paragraphs for Reddit fallback without applying the Bluesky limit', () => {
  const editorialText = 'Play short physics-based sports matches with animal characters. '.repeat(8).trim();
  const facts = { title: 'Sport Animals', description: 'Cute animals and physics…', editorialText, link: 'https://playbound.club/games/sport-animals' };
  const reddit = fallbackSocialDraft('reddit', facts, 'game');
  expect(reddit.body).toBe(`${editorialText}\n\n${facts.link}`);
  expect(reddit.body.length).toBeGreaterThan(300);
  expect(fallbackSocialDraft('bluesky', facts, 'game').body).toBe(facts.description);
  expect(composeSystemPrompt({ ...base, platform: 'reddit', example: '' })).toContain('150–250 words');
});

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

describe('manual post links', () => {
  it('includes the game URL within Bluesky’s full 300-character limit', () => {
    const link = 'https://playbound.club/games/ground-control-2-operation-exodus';
    const copy = manualPostText('Bluesky', 'A useful game announcement. '.repeat(20), link);
    expect(copy).toContain(link);
    expect([...copy].length).toBeLessThanOrEqual(300);
  });
  it('does not duplicate a link already present in Reddit text', () => {
    const body = 'Play this: https://example.com/games/a';
    expect(manualPostText('Reddit', body, 'https://example.com/games/a')).toBe(body);
  });
});

describe('Reddit title for a new item', () => {
  it('relabels a copied "New …:" prefix with the source noun and leaves other titles alone', () => {
    expect(relabelNewItemTitle('New Add: Wreckage - Free FPS', 'game')).toBe('New Game: Wreckage - Free FPS');
    expect(relabelNewItemTitle('new game: Wreckage', 'game')).toBe('New Game: Wreckage');
    expect(relabelNewItemTitle('New Game Release', 'game')).toBe('New Game Release');
    expect(relabelNewItemTitle('Wreckage - Free FPS', 'game')).toBe('Wreckage - Free FPS');
    expect(relabelNewItemTitle('New Release: A Mod: Part Two', 'case study')).toBe('New Case Study: A Mod: Part Two');
  });

  it('builds "New Game: Name" for a plain name, within the Reddit limit', () => {
    expect(newItemTitle('Wreckage - Free FPS', 'game')).toBe('New Game: Wreckage - Free FPS');
    expect(newItemTitle('x'.repeat(400), 'game').length).toBeLessThanOrEqual(300);
  });
});
