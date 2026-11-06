import { describe, expect, it, vi } from 'vitest';
import type { PageCheck } from '@/lib/ai/research/pageChecks';
import { checkedFacts, gatherPostFacts, itemName, pagesWorthOpening, readPostReview } from './postResearch';

const pageText = 'Factorio is a game about building and maintaining automated factories on an alien planet, where you mine resources and research new technology while defending against native creatures.';
const page = { url: 'https://www.pcgamer.com/factorio-review', text: pageText };
const reply = (facts: { fact: string; quote: string }[], sameItem = true) => JSON.stringify({ sameItem, facts });
const good = { fact: 'You build automated factories on an alien planet.', quote: 'building and maintaining automated factories on an alien planet' };

describe('deciding what to open', () => {
  it('names the item, not the site', () => {
    expect(itemName('Factorio · PlayBound')).toBe('Factorio');
    expect(itemName('Half-Life 2 | PlayBound')).toBe('Half-Life 2');
  });

  it('opens one page per site, never our own, and skips video and social feeds', () => {
    expect(pagesWorthOpening([
      { url: 'https://playbound.club/games/factorio' },
      { url: 'https://www.pcgamer.com/factorio-review' },
      { url: 'https://pcgamer.com/another' },
      { url: 'https://www.youtube.com/watch?v=1' },
      { url: 'https://m.facebook.com/factorio' },
      { url: 'https://factorio.com/' },
    ], 'https://playbound.club/games/factorio')).toEqual(['https://www.pcgamer.com/factorio-review', 'https://factorio.com/']);
  });

  it('stops at the limit', () => {
    expect(pagesWorthOpening([{ url: 'https://a.com/' }, { url: 'https://b.com/' }, { url: 'https://c.com/' }], null, 2)).toHaveLength(2);
  });
});

describe('checking what a free model pulled out', () => {
  it('keeps a fact whose words are on the page', () => {
    expect(checkedFacts(reply([good]), page)).toEqual([{ ...good, url: page.url, site: 'pcgamer.com' }]);
  });

  it('drops a fact whose quote is not on the page', () => {
    expect(checkedFacts(reply([{ fact: 'It has dragons.', quote: 'you ride dragons across the burning sky at night' }]), page)).toEqual([]);
  });

  it('drops a quote too short to prove anything', () => {
    expect(checkedFacts(reply([{ fact: 'It is a game.', quote: 'Factorio is a game' }]), page)).toEqual([]);
  });

  it('keeps nothing when the page is about something else, or the reply cannot be read', () => {
    expect(checkedFacts(reply([good], false), page)).toEqual([]);
    expect(checkedFacts('not json', page)).toEqual([]);
    expect(checkedFacts(null, page)).toEqual([]);
  });
});

describe('gathering facts for a post', () => {
  const item = { title: 'Factorio · PlayBound', description: 'Build factories.', link: 'https://playbound.club/games/factorio', noun: 'game' };
  const deps = () => ({
    search: vi.fn(async () => [{ url: 'https://www.pcgamer.com/factorio-review' }]),
    open: vi.fn(async (urls: string[]): Promise<PageCheck[]> => urls.map((url) => ({ url, status: 'opened', title: 'Review', text: pageText }))),
    extract: vi.fn(async () => reply([good])),
  });

  it('searches and opens in code, then asks the free model about each page', async () => {
    const d = deps();
    const facts = await gatherPostFacts(item, d);
    expect(facts).toHaveLength(1);
    expect(d.extract).toHaveBeenCalledTimes(1);
    expect(d.search.mock.calls.flat().join(' ')).toContain('Factorio');
    expect(d.search.mock.calls.flat().join(' ')).not.toContain('PlayBound');
  });

  it('spends no model call on a page that is blocked, missing or never names the item', async () => {
    const d = deps();
    d.open.mockResolvedValue([
      { url: 'https://a.com/', status: 'blocked' as const, title: '', text: '' },
      { url: 'https://b.com/', status: 'gone' as const, title: '', text: '' },
      { url: 'https://c.com/', status: 'opened' as const, title: 'Other', text: 'A page about a completely different thing altogether.' },
    ]);
    expect(await gatherPostFacts(item, d)).toEqual([]);
    expect(d.extract).not.toHaveBeenCalled();
  });

  it('never stops a post from being written', async () => {
    const d = deps();
    d.search.mockRejectedValue(new Error('search down'));
    expect(await gatherPostFacts(item, d)).toEqual([]);
    const e = deps();
    e.open.mockRejectedValue(new Error('browser down'));
    expect(await gatherPostFacts(item, e)).toEqual([]);
    const f = deps();
    f.extract.mockRejectedValue(new Error('model down'));
    expect(await gatherPostFacts(item, f)).toEqual([]);
  });

  it('stops asking when its time is up, and keeps what it has', async () => {
    const d = deps();
    d.open.mockImplementation(async () => ['https://a.com/', 'https://b.com/'].map((url) => ({ url, status: 'opened' as const, title: 'Review', text: pageText })));
    let time = 0;
    d.extract.mockImplementation(async () => {
      time += 10 * 60_000;
      return reply([good]);
    });
    await gatherPostFacts(item, { ...d, now: () => time });
    expect(d.extract).toHaveBeenCalledTimes(1);
  });
});

describe('reading a post review', () => {
  it('reads a pass and a fail, and treats no answer as no review', () => {
    expect(readPostReview('{"verdict":"pass"}')).toEqual({ pass: true, problems: [] });
    expect(readPostReview('{"verdict":"fail","problems":["Sounds generic"]}')).toEqual({ pass: false, problems: ['Sounds generic'] });
    expect(readPostReview('nonsense')).toBeNull();
    expect(readPostReview(null)).toBeNull();
  });
});
