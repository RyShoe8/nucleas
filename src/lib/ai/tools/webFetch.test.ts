import { describe, expect, it, vi } from 'vitest';
import { webFetch } from './webFetch';

describe('webFetch markdown', () => {
  it('returns page text as markdown with structure preserved', async () => {
    const body = 'Plenty of real page content for the reader to use. '.repeat(8);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`<html><title>Plans</title><body><h1>Plans</h1><p>${body}</p><ul><li>One</li><li>Two</li></ul></body></html>`, { headers: { 'content-type': 'text/html' } })
    );
    const result = await webFetch('https://public.example.org/plans', { fetcher });
    expect(result.title).toBe('Plans');
    expect(result.text).toContain('# Plans');
    expect(result.text).toContain('- One');
    expect(result.thin).toBe(false);
  });
});

describe('webFetch links', () => {
  it('returns normalized public HTTPS anchor targets for link verification', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html><title>Listing</title><a href="/target">Target</a><a href="javascript:void(0)">No</a></html>', { headers: { 'content-type': 'text/html' } })
    );
    const result = await webFetch('https://public.example.org/listing', { fetcher });
    expect(result.links).toEqual(['https://public.example.org/target']);
  });
});
