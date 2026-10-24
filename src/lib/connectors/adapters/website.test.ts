import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { websiteConnectorConfigSchema } from '../contracts';
import { websiteAdapter } from './index';

const range = { since: '2026-10-01T00:00:00Z', until: '2026-10-23T00:00:00Z' };
const draft = { idempotencyKey: 'stable', title: 'Title', summary: 'Summary', bodyMarkdown: 'Body', coverageStart: range.since, coverageEnd: range.until, coveredIds: ['arbitrary:release/123'] };
const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
const config = (origin = 'https://one.com') => websiteConnectorConfigSchema.parse({ version: 1, adapter: 'website-v1', origin,
  collection: 'articles', permissions: ['content.items.list', 'content.posts.publish', 'content.posts.read'] });
const item = { id: '1', kind: 'article', title: 'Hello', url: 'https://one.com/item', publishedAt: null, publicationBasis: 'unknown', fields: {} };
describe('website adapter contracts and signed transport', () => {
  it.each(['https://one.com', 'https://two.com'])('normalizes mapped collections and runs all operations at %s while disabled', async origin => {
    const cfg = { ...config(origin), collection: origin.includes('one') ? 'articles' : 'releases', fields: { title: origin.includes('one') ? 'heading' : 'label' } };
    const receipt = { version: 1, idempotencyKey: 'stable', externalId: 'post-1', url: origin + '/post', status: 'published' };
    const { title, ...rest } = { ...item, url: origin + '/item' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ version: 1, items: [{ ...rest, [cfg.fields.title]: title }], warnings: [] }))
      .mockResolvedValueOnce(Response.json(receipt)).mockResolvedValueOnce(Response.json(receipt));
    const adapter = websiteAdapter(cfg, { fetch: fetcher, lookup, now: () => 1000 });
    expect(cfg.enabled).toBe(false);
    expect((await adapter.list(range, 'secret')).items[0].title).toBe('Hello');
    expect(await adapter.publish(draft, 'secret')).toEqual(receipt);
    expect(await adapter.read({ idempotencyKey: 'stable' }, 'secret')).toEqual(receipt);
    for (const [target, init] of fetcher.mock.calls) {
      const u = new URL(String(target)); expect(u.origin).toBe(origin); expect(init?.redirect).toBe('error');
      const expected = createHmac('sha256', 'secret').update(`1.${init!.method}.${u.pathname}${u.search}.${init!.body ?? ''}`).digest('hex');
      expect((init!.headers as Record<string, string>)['x-nucleas-signature']).toBe(expected);
    }
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('collection')).toBe(cfg.collection);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]!.body)).coveredIds).toEqual(draft.coveredIds);
  });
  it('returns only explicit typed missing receipts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ version: 1, status: 'missing', idempotencyKey: 'stable' }))
      .mockResolvedValueOnce(Response.json({}));
    const adapter = websiteAdapter(config(), { lookup, fetch: fetcher });
    expect((await adapter.read({ idempotencyKey: 'stable' }, 's')).status).toBe('missing');
    await expect(adapter.read({ idempotencyKey: 'stable' }, 's')).rejects.toThrow();
  });
  it.each(['https://localhost', 'http://one.com', 'https://one.com/path', 'https://user:pass@one.com'])('rejects unsafe origins %s', origin => {
    expect(() => config(origin)).toThrow();
  });
  it.each(['//evil.com', '/api/../other', '/api/%2e%2e', '/api?x=y', '/api\\other', '/api#x'])('rejects path %s', endpointPath => {
    expect(() => websiteConnectorConfigSchema.parse({ ...config(), endpointPath })).toThrow();
  });
  it('rejects unsigned, unpermitted and private DNS requests before fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(websiteAdapter(config(), { lookup, fetch: fetcher }).list(range, '')).rejects.toThrow();
    await expect(websiteAdapter({ ...config(), permissions: [] }, { lookup, fetch: fetcher }).list(range, 's')).rejects.toThrow();
    await expect(websiteAdapter(config(), { lookup: async () => [{ address: '127.0.0.1', family: 4 }], fetch: fetcher }).list(range, 's')).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([302, 401])('rejects HTTP %s', status => {
    const adapter = websiteAdapter(config(), { lookup, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status })) });
    return expect(adapter.list(range, 's')).rejects.toThrow();
  });
  it('rejects mappings with prototype paths or collisions and ambiguous items', async () => {
    for (const fields of [{ title: 'constructor' }, { title: 'nested.title' }, { title: 'id' }])
      expect(() => websiteConnectorConfigSchema.parse({ ...config(), fields })).toThrow();
    const adapter = websiteAdapter({ ...config(), fields: { title: 'heading' } }, { lookup, fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ version: 1, items: [{ ...item, heading: 'other' }], warnings: [] })) });
    await expect(adapter.list(range, 's')).rejects.toThrow('Ambiguous');
  });
  it('bounds response bytes and item counts', async () => {
    for (const response of [new Response('x'.repeat(2000001)), Response.json({ version: 1, items: Array(2001).fill(item), warnings: [] })]) {
      await expect(websiteAdapter(config(), { lookup, fetch: vi.fn<typeof fetch>().mockResolvedValue(response) }).list(range, 's')).rejects.toThrow();
    }
  });
  it('marks mismatched publication acknowledgements uncertain', async () => {
    const adapter = websiteAdapter(config(), { lookup, fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ version: 1, idempotencyKey: 'wrong', externalId: '1', url: 'https://evil.com/post', status: 'published' })) });
    await expect(adapter.publish(draft, 's')).rejects.toMatchObject({ code: 'publication_uncertain' });
  });
  it('does not accept a receipt whose supplied content hash is wrong', async () => {
    const adapter = websiteAdapter(config(), { lookup, fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ version: 1, idempotencyKey: draft.idempotencyKey, externalId: 'post-1', url: 'https://one.com/post', status: 'published', payloadHash: '0'.repeat(64) })) });
    await expect(adapter.publish(draft, 's')).rejects.toMatchObject({ code: 'publication_uncertain' });
  });
  it('accepts generated legacy baseline aliases using effective coverage and sorted IDs', async () => {
    const baseline = { publishedAt: range.until, coverageEnd: range.until, coveredIds: ['a', 'b'], slug: 'generated' };
    const previousRoundup = { ...baseline, publishedAt: '2026-10-23T12:00:00Z', coveredIds: ['b', 'a'], extra: 'ignored' };
    const adapter = websiteAdapter({ ...config(), adapter: 'playbound-roundup-v0' }, { lookup,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ games: [], baseline, previousRoundup })) });
    expect((await adapter.list(range, 's')).baseline?.coverageEnd).toBe(range.until);
  });
  it('rejects off-origin content URLs', async () => {
    const adapter = websiteAdapter(config(), { lookup, fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ version: 1, items: [{ ...item, url: 'https://evil.com/item' }], warnings: [] })) });
    await expect(adapter.list(range, 's')).rejects.toThrow('configured origin');
  });
  it('normalizes legacy games, rejects conflicting baselines, and verifies durable post contents', async () => {
    const cfg = { ...config(), adapter: 'playbound-roundup-v0' as const };
    const post = { sourceKey: 'nucleas:roundup:stable', publishedAt: range.until, url: cfg.origin + '/post', ...draft };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ games: [{ id: 'a'.repeat(24), slug: 'game', title: 'Game', url: cfg.origin + '/game', publishedAt: range.since }] }))
      .mockResolvedValueOnce(Response.json({ created: true, post }))
      .mockResolvedValueOnce(Response.json({ created: false, post: { ...post, bodyMarkdown: 'changed' } }));
    const adapter = websiteAdapter(cfg, { lookup, fetch: fetcher });
    expect((await adapter.list(range, 's')).items[0].kind).toBe('game');
    expect((await adapter.publish(draft, 's')).externalId).toBe(post.sourceKey);
    await expect(adapter.publish(draft, 's')).rejects.toMatchObject({ code: 'publication_uncertain' });
    await expect(adapter.read({ idempotencyKey: 'stable' }, 's')).rejects.toThrow('does not support');
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/integrations/nucleas/roundup');
  });
});
