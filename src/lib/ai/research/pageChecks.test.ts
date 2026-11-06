import { beforeEach, describe, expect, it, vi } from 'vitest';

const webFetch = vi.fn();
const browserFetch = vi.fn();
vi.mock('@/lib/ai/tools/webFetch', () => ({ webFetch: (...args: unknown[]) => webFetch(...args) }));
vi.mock('@/lib/ai/tools/browserClient', () => ({
  browserFetch: (...args: unknown[]) => browserFetch(...args),
  plainPageText: (html: string) => html.replace(/<[^>]+>/g, ' ').trim(),
}));

import { addChecksToEvidence, checkAnswerLinks, checkPage, checkPages, describeChecks, describeSizes, linksToCheck, removeLinksTo, siteSizes, sitesIn } from './pageChecks';

const words = 'A full review of the game with plenty to read on the page. '.repeat(6);
const url = 'https://site.com/review';

beforeEach(() => {
  webFetch.mockReset();
  browserFetch.mockReset();
});

describe('opening a page before believing it', () => {
  it('accepts a page that reads normally', async () => {
    webFetch.mockResolvedValue({ url, title: 'Review', text: words, thin: false });
    expect(await checkPage(url)).toMatchObject({ status: 'opened', title: 'Review' });
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it('asks the real browser before giving up on a failed fetch', async () => {
    webFetch.mockRejectedValue(new Error('Fetch failed with HTTP 403.'));
    browserFetch.mockResolvedValue({ status: 200, body: `<title>Review</title><p>${words}</p>` });
    expect(await checkPage(url)).toMatchObject({ status: 'opened', title: 'Review' });
  });

  it('calls a page gone only when the browser confirms it', async () => {
    webFetch.mockRejectedValue(new Error('Fetch failed with HTTP 404.'));
    browserFetch.mockResolvedValue({ status: 404, body: '' });
    expect((await checkPage(url)).status).toBe('gone');
  });

  it('spots a missing page that answers normally', async () => {
    webFetch.mockResolvedValue({ url, title: 'Page Not Found | Site', text: words, thin: false });
    expect((await checkPage(url)).status).toBe('gone');
  });

  it('never treats a blocked page as proof it is missing', async () => {
    webFetch.mockRejectedValue(new Error('Fetch failed with HTTP 403.'));
    browserFetch.mockResolvedValue({ status: 403, body: 'Forbidden' });
    expect((await checkPage(url)).status).toBe('blocked');
    browserFetch.mockRejectedValue(new Error('Browser worker is not configured.'));
    expect((await checkPage(url)).status).toBe('blocked');
  });

  it('checks every page in a list', async () => {
    webFetch.mockResolvedValue({ title: 'Page', text: words, thin: false });
    const checks = await checkPages(['https://a.com/', 'https://b.com/', 'https://c.com/', 'https://d.com/']);
    expect(checks.map((check) => check.url).sort()).toEqual(['https://a.com/', 'https://b.com/', 'https://c.com/', 'https://d.com/']);
  });
});

describe('what comes of the checks', () => {
  it('finds links not checked yet, once each', () => {
    expect(linksToCheck('[A](https://a.com/x) [A again](https://a.com/x/) [B](https://b.com/) [Local](https://localhost/x)', ['https://b.com'])).toEqual(['https://a.com/x']);
  });

  it('tells the next model what is real', () => {
    const text = describeChecks([
      { url: 'https://a.com/', status: 'opened', title: 'A', text: 'Body   text' },
      { url: 'https://b.com/', status: 'gone' },
      { url: 'https://c.com/', status: 'blocked' },
    ]);
    expect(text).toContain('OPENED https://a.com/ "A": Body text');
    expect(text).toContain('GONE https://b.com/');
    expect(text).toContain('BLOCKED https://c.com/');
  });

  it('removes links to pages that do not exist and keeps their words', () => {
    const answer = '| [Gamefa](https://gamefa.com/) | [Review](https://gamefa.com/reviews/x) |\n[IGN](https://ign.com/a)';
    expect(removeLinksTo(answer, ['https://gamefa.com/reviews/x/'])).toEqual({ text: '| [Gamefa](https://gamefa.com/) | Review |\n[IGN](https://ign.com/a)', removed: 1 });
  });
});

describe('checking the links in a finished answer', () => {
  it('opens what has not been opened, and removes links to missing pages', async () => {
    webFetch.mockImplementation(async (address: string) => (address.includes('invented') ? { url: address, title: 'Page not found', text: words, thin: false } : { url: address, title: 'Real', text: words, thin: false }));
    const answer = 'See [Real](https://real.com/a), [Made up](https://invented.com/a) and [Known](https://known.com/a).';
    const result = await checkAnswerLinks(answer, ['https://known.com/a'], []);
    expect(result.text).toBe('See [Real](https://real.com/a), Made up and [Known](https://known.com/a).');
    expect(result.removed).toBe(1);
    expect(result.checks.map((check) => check.url).sort()).toEqual(['https://invented.com/a', 'https://real.com/a']);
    expect(webFetch).toHaveBeenCalledTimes(2);
  });

  it('removes links already known to be missing without opening them again', async () => {
    const result = await checkAnswerLinks('[Gone](https://gone.com/a)', ['https://gone.com/a'], ['https://gone.com/a']);
    expect(result).toEqual({ text: 'Gone', removed: 1, checks: [] });
    expect(webFetch).not.toHaveBeenCalled();
  });

  it('records the results where the details can show them', () => {
    const evidence = { sources: [], images: [], data: [] };
    addChecksToEvidence(evidence, [{ url: 'https://a.com/', status: 'opened', title: 'A', text: 'Body' }, { url: 'https://b.com/', status: 'gone' }, { url: 'https://c.com/', status: 'blocked' }]);
    expect(evidence.sources).toMatchObject([{ title: 'A', read: true }, { gone: true }, { blocked: true }]);
  });
});

describe('how big a site is', () => {
  const answerWith = (rank: number) => new Response(JSON.stringify({ ranks: [{ date: '2026-11-05', rank }, { date: '2026-11-04', rank: 1 }] }));

  it('lists sites by how often they come up', () => {
    expect(sitesIn('[a](https://www.ign.com/a) [b](https://ign.com/b) [c](https://pcgamer.com/c)')).toEqual(['ign.com', 'pcgamer.com']);
  });

  it('uses the latest rank, and waits and retries when told to slow down', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(answerWith(2098))
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(answerWith(500));
    expect(await siteSizes(['ign.com', 'pcgamer.com'], { fetcher, pauseMs: 0 })).toEqual([{ host: 'ign.com', rank: 2098 }, { host: 'pcgamer.com', rank: 500 }]);
  });

  it('leaves a site it cannot find unknown, and carries on', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(new Response(JSON.stringify({ ranks: [] }))).mockResolvedValueOnce(answerWith(9));
    expect(await siteSizes(['a.com', 'b.com', 'c.com'], { fetcher, pauseMs: 0 })).toEqual([{ host: 'a.com', rank: null }, { host: 'b.com', rank: null }, { host: 'c.com', rank: 9 }]);
  });

  it('sorts biggest first and says what the number is', () => {
    const text = describeSizes([{ host: 'small.com', rank: 90000 }, { host: 'none.com', rank: null }, { host: 'big.com', rank: 2098 }]);
    expect(text.indexOf('big.com: #2,098')).toBeLessThan(text.indexOf('small.com: #90,000'));
    expect(text.indexOf('small.com')).toBeLessThan(text.indexOf('none.com: not ranked'));
    expect(text).toContain('Tranco');
  });
});
