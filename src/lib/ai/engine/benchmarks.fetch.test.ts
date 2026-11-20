import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBenchmarkSource, benchmarkRows, benchmarkStatus, mediaLeaderboards, saveBenchmarkKey } from './benchmarks';

vi.mock('@/lib/ai/modelSecrets', () => ({
  decryptModelSecret: () => 'synthetic-test-key',
  encryptModelSecret: () => 'synthetic-ciphertext',
  secretLast4: () => 'test',
}));

const language = (slug: string) => ({ slug, name: slug, model_creator: { name: 'Test' }, evaluations: { artificial_analysis_intelligence_index: 42, artificial_analysis_coding_index: null } });
const media = (slug: string) => ({ slug, name: slug, elo: 1200, ci_95: 9 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const oldDate = new Date('2026-01-01T00:00:00Z');
const savedRow = { slug: 'cached', name: 'Cached', creator: 'Test', intelligence: 40, coding: 39, math: null };
let stored: Record<string, unknown>;
function lastUpdate() {
  const calls = vi.mocked(AiBenchmarkSource.updateOne).mock.calls as unknown as [unknown, { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }][];
  return calls.at(-1)![1];
}

beforeEach(() => {
  stored = { apiKeyCiphertext: 'test', rows: [savedRow], fetchedAt: oldDate, apiRevision: 2 };
  vi.spyOn(AiBenchmarkSource, 'findOne').mockImplementation(() => ({ lean: async () => stored }) as never);
  vi.spyOn(AiBenchmarkSource, 'updateOne').mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Artificial Analysis supported feeds', () => {
  it('migrates a recently attempted legacy cache and reads all language pages with the same key', async () => {
    stored.apiRevision = undefined;
    stored.attemptedAt = new Date();
    stored.error = 'Artificial Analysis returned 410.';
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ tier: 'free', pagination: { page: 1, total_pages: 2, has_more: true }, data: [language('first')] }))
      .mockResolvedValueOnce(json({ tier: 'free', pagination: { page: 2, total_pages: 2, has_more: false }, data: [language('second')] }));
    const rows = await benchmarkRows();
    expect(rows.map(row => row.slug)).toEqual(['first', 'second']);
    expect(rows[0].coding).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual([
      'https://artificialanalysis.ai/api/v2/language/models/free',
      'https://artificialanalysis.ai/api/v2/language/models/free?page=2',
    ]);
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { 'x-api-key': 'synthetic-test-key' } }));
    expect(AiBenchmarkSource.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $unset: { error: '' }, $set: expect.objectContaining({ rows, apiRevision: 2, fetchedAt: expect.any(Date) }) }));
  });

  it.each(['http', 'pagination', 'empty', 'scores'] as const)('retains the complete cached list and success date when refresh fails: %s', async failure => {
    if (failure === 'scores') vi.mocked(fetch).mockResolvedValueOnce(json({ data: [{ slug: 'unscored' }] }));
    else {
      vi.mocked(fetch).mockResolvedValueOnce(json({ pagination: { page: 1, total_pages: 2, has_more: true }, data: [language('first')] }));
      vi.mocked(fetch).mockResolvedValueOnce(failure === 'http' ? json({}, 503) : failure === 'empty' ? json({ data: [] }) : json({ pagination: { page: 1, total_pages: 2, has_more: true }, data: [language('repeat')] }));
    }
    expect(await benchmarkRows(true)).toEqual([savedRow]);
    const update = lastUpdate();
    expect(update?.$set).toMatchObject({ attemptedAt: expect.any(Date), error: expect.any(String) });
    expect(update?.$set).not.toHaveProperty('fetchedAt');
    expect(update?.$set).not.toHaveProperty('rows');
  });

  it('does not treat a failed refresh as fresh scores or retry on every request', async () => {
    stored.attemptedAt = new Date();
    stored.error = 'Artificial Analysis returned 503.';
    expect(await benchmarkRows()).toEqual([savedRow]);
    expect(fetch).not.toHaveBeenCalled();
    expect(await benchmarkStatus()).toMatchObject({ fetchedAt: oldDate.toISOString(), error: stored.error });
  });

  it('does not retain an old failure timestamp as the last successful fetch during migration', async () => {
    stored.apiRevision = undefined;
    stored.error = 'Artificial Analysis returned 410.';
    expect(await benchmarkStatus()).toMatchObject({ fetchedAt: null });
    vi.mocked(fetch).mockResolvedValue(json({}, 503));
    await benchmarkRows();
    expect(lastUpdate().$unset).toEqual({ fetchedAt: '' });
  });

  it('loads image and video Free endpoints with numeric confidence intervals and optional Pro fields absent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ tier: 'free', data: [media('image')] })).mockResolvedValueOnce(json({ tier: 'free', data: [media('video')] }));
    const result = await mediaLeaderboards();
    expect(result.error).toBeNull();
    expect(result.image[0]).toMatchObject({ slug: 'image', elo: 1200, ci95: '±9', rank: null, appearances: null });
    expect(result.video[0].slug).toBe('video');
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual([
      'https://artificialanalysis.ai/api/v2/media/text-to-image/models/free',
      'https://artificialanalysis.ai/api/v2/media/text-to-video/models/free',
    ]);
  });

  it('preserves a failed media feed independently without claiming both feeds refreshed', async () => {
    stored.media = { image: [media('cached-image')] };
    stored.mediaFetchedAt = oldDate;
    stored.mediaApiRevision = 2;
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ data: [media('new-video')] }));
    const result = await mediaLeaderboards();
    expect(result.image[0].slug).toBe('cached-image');
    expect(result.video[0].slug).toBe('new-video');
    expect(result.fetchedAt).toBe(oldDate.toISOString());
    expect(result.error).toContain('503');
    expect(lastUpdate().$set).not.toHaveProperty('mediaFetchedAt');
  });

  it.each([401, 403])('distinguishes bad keys from access refusals: HTTP %i', async status => {
    vi.mocked(fetch).mockResolvedValue(json({}, status));
    const result = await saveBenchmarkKey('test-key');
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(status === 401 ? 'rejected the API key' : 'denied access') });
    expect(AiBenchmarkSource.updateOne).not.toHaveBeenCalled();
  });
});
