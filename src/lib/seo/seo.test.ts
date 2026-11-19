import { describe, expect, it, vi } from 'vitest';
import { expansionsFor, keywordIdeas } from './keywordIdeas';
import { outlineFromHtml } from './pageOutline';

const suggestions = (query: string, list: string[]) => new Response(JSON.stringify([query, list]), { status: 200 });

describe('keywordIdeas', () => {
  it('asks the seed, question words, joiners and a-z, and keeps each idea once', async () => {
    expect(expansionsFor('slot odds', true)).toHaveLength(1 + 11 + 7 + 26);
    expect(expansionsFor('slot odds', false)).toEqual([{ query: 'slot odds', from: 'seed' }]);

    const fetchImpl = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get('q')!;
      if (q === 'how slot odds') return suggestions(q, ['how slot odds work', 'Slot Odds Calculator']);
      if (q === 'slot odds c') throw new Error('network');
      return suggestions(q, ['slot odds calculator', 'slot odds']);
    });
    const out = await keywordIdeas({ seed: '  Slot   Odds ', country: 'GB' }, { fetchImpl, pauseMs: 0 });

    expect(out).toMatchObject({ seed: 'slot odds', country: 'gb', language: 'en', requests: 45, failedRequests: 1 });
    // The seed itself is not an idea; duplicates in any case collapse to one.
    expect(out.ideas.map((i) => i.keyword)).toEqual(['slot odds calculator', 'how slot odds work']);
    expect(out.questions).toEqual(['how slot odds work']);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('gl=gb');
  });

  it('fails clearly when Google does not answer at all, and rejects an empty seed', async () => {
    await expect(keywordIdeas({ seed: 'slot odds', expand: false }, { fetchImpl: vi.fn(async () => new Response('', { status: 429 })), pauseMs: 0 })).rejects.toThrow('did not answer');
    await expect(keywordIdeas({ seed: ' ' }, { fetchImpl: vi.fn(), pauseMs: 0 })).rejects.toThrow('at least two characters');
  });
});

describe('outlineFromHtml', () => {
  it('reads the SEO structure of a page', () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>Best Slot Apps &amp; Odds (2026)</title>
      <meta name="description" content="Which slot apps pay best.">
      <link rel="canonical" href="https://example.com/best-slot-apps">
      <meta property="article:modified_time" content="2026-10-01T00:00:00Z">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article","datePublished":"2026-01-02"},{"@type":"FAQPage"}]}</script>
      <script>var ignored = "<h2>not a heading</h2>";</script>
    </head><body>
      <nav><a href="/home">Home</a> lots of menu words</nav>
      <main><h1>Best <em>slot</em> apps</h1><p>Five words of real content.</p>
        <h2>How we tested</h2><h3>Payout rates</h3><h2>FAQ</h2>
        <a href="https://example.com/a">a</a><a href="https://www.example.com/b">b</a><a href="https://other.org/c">c</a>
        <img src="x.png" alt="chart"><img src="y.png">
      </main></body></html>`;
    const outline = outlineFromHtml(html, 'https://example.com/best-slot-apps', 'direct');
    expect(outline).toMatchObject({
      title: 'Best Slot Apps & Odds (2026)',
      metaDescription: 'Which slot apps pay best.',
      canonical: 'https://example.com/best-slot-apps',
      language: 'en',
      headings: [{ level: 1, text: 'Best slot apps' }, { level: 2, text: 'How we tested' }, { level: 3, text: 'Payout rates' }, { level: 2, text: 'FAQ' }],
      links: { internal: 3, external: 1 },
      images: { total: 2, missingAlt: 1 },
      structuredData: ['Article', 'FAQPage'],
      published: '2026-01-02',
      modified: '2026-10-01T00:00:00Z',
    });
    // Counted inside <main>, so navigation words are left out.
    expect(outline.wordCount).toBeLessThan(25);
  });
});
