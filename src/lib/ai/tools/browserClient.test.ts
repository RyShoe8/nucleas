import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/tools/browseRouter', () => ({
  isBrowserWorkerConfigured: () => true,
}));

vi.mock('@/lib/ai/tools/ssrf', () => ({
  assertSafePublicHttpsUrl: (url: string) => new URL(url),
}));

import { browserNavigate, browserObserve } from '@/lib/ai/tools/browserClient';

describe('browserNavigate', () => {
  it('parses images from the worker JSON body', async () => {
    vi.stubEnv('NUCLEAS_BROWSER_WORKER_URL', 'https://browser.example.com');
    vi.stubEnv('NUCLEAS_BROWSER_WORKER_SECRET', 'x'.repeat(24));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        url: 'https://example.com/game',
        title: 'Game',
        text: 'Gameplay page',
        images: [
          'https://cdn.example.com/shot.png',
          'data:image/png;base64,abc',
          'https://cdn.example.com/shot.png',
        ],
      })
    );

    const result = await browserNavigate('https://example.com/game', { fetcher });
    expect(result.text).toMatch(/Gameplay/);
    expect(result.images).toEqual(['https://cdn.example.com/shot.png']);
    expect(result.note).toMatch(/Playwright/i);
  });
});

describe('browserObserve', () => {
  it('sends the account to the worker\u2019s /observe and never returns the password', async () => {
    vi.stubEnv('NUCLEAS_BROWSER_WORKER_URL', 'https://browser.example.com');
    vi.stubEnv('NUCLEAS_BROWSER_WORKER_SECRET', 'x'.repeat(24));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ url: 'https://site.example/admin/games', title: 'Games', loggedIn: true, text: 'OpenHV', note: 'Logged in with the test account.' }));
    const result = await browserObserve({ baseUrl: 'https://site.example', url: 'https://site.example/admin/games', username: 'tester', password: 's3cret' }, { fetcher });
    expect(fetcher.mock.calls[0][0].toString()).toBe('https://browser.example.com/observe');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ baseUrl: 'https://site.example', username: 'tester', password: 's3cret' });
    expect(result).toMatchObject({ loggedIn: true, text: 'OpenHV' });
    expect(JSON.stringify(result)).not.toContain('s3cret');
  });

  it('refuses a page outside the account\u2019s site', async () => {
    vi.stubEnv('NUCLEAS_BROWSER_WORKER_URL', 'https://browser.example.com');
    vi.stubEnv('NUCLEAS_BROWSER_WORKER_SECRET', 'x'.repeat(24));
    await expect(browserObserve({ baseUrl: 'https://site.example', url: 'https://other.example/x', username: 'u', password: 'p' })).rejects.toThrow('outside');
  });
});
