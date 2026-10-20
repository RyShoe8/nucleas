import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { forgetRefusedHosts, withBrowserFallback } from './browserFallback';

const page = (status: number, body = '<urlset></urlset>', contentType = 'application/xml') => ({ url: 'https://site.example/sitemap.xml', status, contentType, body });
const text = { headers: { accept: 'application/xml,text/xml,*/*;q=0.5' } };

beforeEach(() => forgetRefusedHosts());

describe('browser fallback for pages that refuse Nucleas’s servers', () => {
  it('leaves an ordinary answer alone and never starts the browser', async () => {
    const base = vi.fn(async () => new Response('ok', { status: 200 }));
    const browser = vi.fn();
    const res = await withBrowserFallback(base, browser, () => true)('https://site.example/a', text);
    expect(await res.text()).toBe('ok');
    expect(browser).not.toHaveBeenCalled();
  });

  it('asks the browser worker when the site answers 403, and returns its body as a normal response', async () => {
    const base = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const browser = vi.fn(async () => page(200, '<urlset><url><loc>https://site.example/news/a</loc></url></urlset>'));
    const res = await withBrowserFallback(base, browser, () => true)('https://site.example/sitemap.xml', text);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml');
    expect(await res.text()).toContain('/news/a');
    expect(browser).toHaveBeenCalledWith('https://site.example/sitemap.xml');
  });

  it('goes straight to the worker for a host that refused recently', async () => {
    const base = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const browser = vi.fn(async () => page(200, '<html></html>', 'text/html'));
    const fetcher = withBrowserFallback(base, browser, () => true);
    await fetcher('https://site.example/one', text);
    await fetcher('https://site.example/two', text);
    expect(base).toHaveBeenCalledTimes(1);
    expect(browser).toHaveBeenCalledTimes(2);
  });

  it('keeps the site’s own answer when the worker is unavailable, fails, or is refused too', async () => {
    const forbidden = () => new Response('forbidden', { status: 403 });
    expect((await withBrowserFallback(async () => forbidden(), vi.fn(), () => false)('https://site.example/a', text)).status).toBe(403);
    expect((await withBrowserFallback(async () => forbidden(), async () => { throw new Error('worker down'); }, () => true)('https://site.example/b', text)).status).toBe(403);
    expect((await withBrowserFallback(async () => forbidden(), async () => page(403), () => true)('https://site.example/c', text)).status).toBe(403);
  });

  it('does not use the browser for a real not-found, for images, or for anything but a plain GET', async () => {
    const browser = vi.fn(async () => page(200));
    expect((await withBrowserFallback(async () => new Response('', { status: 404 }), browser, () => true)('https://site.example/gone', text)).status).toBe(404);
    expect((await withBrowserFallback(async () => new Response('', { status: 403 }), browser, () => true)('https://site.example/i.png', { headers: { accept: 'image/*' } })).status).toBe(403);
    expect((await withBrowserFallback(async () => new Response('', { status: 403 }), browser, () => true)('https://site.example/post', { ...text, method: 'POST' })).status).toBe(403);
    expect(browser).not.toHaveBeenCalled();
  });
});
