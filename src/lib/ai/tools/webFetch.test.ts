import { describe, expect, it, vi } from 'vitest';
import { webFetch } from './webFetch';

describe('webFetch links', () => {
  it('returns normalized public HTTPS anchor targets for link verification', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html><title>Listing</title><a href="/target">Target</a><a href="javascript:void(0)">No</a></html>', { headers: { 'content-type': 'text/html' } })
    );
    const result = await webFetch('https://public.example.org/listing', { fetcher });
    expect(result.links).toEqual(['https://public.example.org/target']);
  });
});
