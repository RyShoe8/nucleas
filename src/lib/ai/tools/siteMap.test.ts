import { describe, expect, it, vi } from 'vitest';
import { mapSite } from './siteMap';

function site(files: Record<string, string>) {
  return vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    const body = files[path];
    return body === undefined ? new Response('', { status: 404 }) : new Response(body, { headers: { 'content-type': 'text/html' } });
  });
}

describe('mapSite', () => {
  it('reads sitemaps declared in robots.txt, follows an index, and keeps only same-origin pages', async () => {
    const fetcher = site({
      '/robots.txt': 'User-agent: *\nSitemap: https://public.example.org/index.xml\n',
      '/index.xml': '<sitemapindex><sitemap><loc>https://public.example.org/a.xml</loc></sitemap></sitemapindex>',
      '/a.xml': '<urlset><url><loc>https://public.example.org/pricing#top</loc></url><url><loc>https://public.example.org/docs?a=1&amp;b=2</loc></url><url><loc>https://other.example.net/x</loc></url></urlset>',
    });
    const result = await mapSite('https://public.example.org/', { fetcher });
    expect(result.source).toBe('sitemap');
    expect(result.urls).toEqual(['https://public.example.org/pricing', 'https://public.example.org/docs?a=1&b=2']);
  });

  it('falls back to home page links and honours search and limit', async () => {
    const fetcher = site({
      '/': '<html><body><a href="/blog/one">1</a><a href="/blog/two">2</a><a href="/about">About</a><a href="https://elsewhere.example.net/">Out</a></body></html>',
    });
    const result = await mapSite('https://public.example.org/', { fetcher, search: 'blog', limit: 1 });
    expect(result.source).toBe('links');
    expect(result.total).toBe(2);
    expect(result.urls).toEqual(['https://public.example.org/blog/one']);
  });

  it('refuses private hosts', async () => {
    await expect(mapSite('https://localhost/')).rejects.toThrow();
  });
});
