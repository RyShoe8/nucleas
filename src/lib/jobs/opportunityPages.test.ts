import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/tools/webFetch', () => ({ webFetch: vi.fn() }));

import { deadOpportunityPages, deadPageProblem } from './opportunityPages';

const fetcherFor = (answers: Record<string, string | null>) => async (url: string) => {
  const failure = answers[url];
  if (failure) throw new Error(failure);
  return {};
};

describe('recommended pages that do not exist', () => {
  it('flags pages that are not found or are not public HTTPS pages, with their position', async () => {
    const dead = await deadOpportunityPages(
      ['https://github.com/topics/game-launcher', 'https://example.com/ok', 'http://example.com/plain', 'https://gone.example/page'],
      fetcherFor({
        'https://github.com/topics/game-launcher': 'Fetch failed with HTTP 404.',
        'http://example.com/plain': 'Only HTTPS URLs are allowed.',
        'https://gone.example/page': 'Fetch failed with HTTP 410.',
      })
    );
    expect(dead).toEqual([
      { index: 0, url: 'https://github.com/topics/game-launcher', status: 404 },
      { index: 2, url: 'http://example.com/plain', status: 0 },
      { index: 3, url: 'https://gone.example/page', status: 410 },
    ]);
  });

  it('does not flag sites that block automated readers, time out or fail, and ignores empty addresses', async () => {
    const dead = await deadOpportunityPages(
      ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', '  '],
      fetcherFor({ 'https://a.example': 'Fetch failed with HTTP 403.', 'https://b.example': 'Fetch failed with HTTP 429.', 'https://c.example': 'Fetch failed with HTTP 503.', 'https://d.example': 'The operation was aborted due to timeout' })
    );
    expect(dead).toEqual([]);
  });

  it('says what is wrong in words the model can act on', () => {
    expect(deadPageProblem({ index: 0, url: 'https://x.example/a', status: 404 })).toMatch(/does not exist \(HTTP 404\)/);
    expect(deadPageProblem({ index: 0, url: 'http://x.example/a', status: 0 })).toMatch(/not a public HTTPS page/);
  });
});
