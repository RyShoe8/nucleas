import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import { getWebsiteConnection, getPinnedWebsiteConnection } from '@/lib/connectors/connections';
import { invokeCapability } from '@/lib/capabilities/runtime';
import { websiteAdapter } from '@/lib/connectors/adapters';
import { selectRoundupTransport, assertRoundupConnection, connectorCoverageId, connectorPublishIds, publishConnectorSnapshot, listConnectorItems } from './connectorBridge';

vi.mock('@/lib/connectors/connections', () => ({ getWebsiteConnection: vi.fn(), getPinnedWebsiteConnection: vi.fn() }));
vi.mock('@/lib/capabilities/runtime', () => ({ invokeCapability: vi.fn() }));
vi.mock('@/lib/capabilities/registry', () => ({ CAPABILITIES: [] }));
vi.mock('@/lib/connectors/adapters', () => ({ websiteAdapter: vi.fn(() => ({ list: vi.fn(), publish: vi.fn() })) }));
const viewer = { userId: 'manager', organizationId: new Types.ObjectId(), employeeId: null, role: 'Manager' } as CompanyViewer;
const binding = { kind: 'connector' as const, connectionId: 'company-one-connection', revision: 3, origin: 'https://one.example.com' };
const connection = { connectionId: binding.connectionId, revision: 3, config: { version: 1 as const, adapter: 'website-v1' as const, origin: binding.origin, endpointPath: '/api/nucleas/v1', enabled: true, collection: 'news', permissions: ['content.items.list' as const] }, credential: 'never-return-this' };
const input = { idempotencyKey: 'stable-key', title: 'Title', summary: 'Summary', bodyMarkdown: 'Body', coverageStart: '2026-10-02T00:00:00.000Z', coverageEnd: '2026-10-20T00:00:00.000Z', coveredIds: ['arbitrary/news:42'] };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'false'); vi.mocked(getPinnedWebsiteConnection).mockResolvedValue(connection); });
describe('guarded connector bridge', () => {
  it('defaults to legacy without any connection query or capability call', async () => {
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', '');
    expect(await selectRoundupTransport(viewer, 'one')).toEqual({ kind: 'legacy' });
    expect(getWebsiteConnection).not.toHaveBeenCalled(); expect(invokeCapability).not.toHaveBeenCalled();
  });
  it('copies only the company binding and never persists credentials', async () => {
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true'); vi.mocked(getWebsiteConnection).mockResolvedValue(connection);
    const selected = await selectRoundupTransport(viewer, 'one');
    expect(selected).toEqual(binding); expect(getWebsiteConnection).toHaveBeenCalledWith(viewer, 'one');
    connection.revision = 4; expect(selected.revision).toBe(3); connection.revision = 3;
  });
  it('blocks pinned drafts while disabled without resolving another connection', async () => {
    await expect(assertRoundupConnection(viewer, 'one', binding)).rejects.toThrow('disabled');
    expect(getPinnedWebsiteConnection).not.toHaveBeenCalled(); expect(invokeCapability).not.toHaveBeenCalled();
  });
  it('blocks changed bindings instead of selecting a replacement', async () => {
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true'); vi.mocked(getPinnedWebsiteConnection).mockRejectedValueOnce(new Error('connection changed'));
    await expect(publishConnectorSnapshot(viewer, 'one', binding, input)).rejects.toThrow('changed');
    expect(getWebsiteConnection).not.toHaveBeenCalled(); expect(invokeCapability).not.toHaveBeenCalled();
  });
  it('retains arbitrary publish IDs without repository collisions', () => {
    const raw = ['github:org/repo:42', 'item/with spaces', 'website:abc', '42'];
    expect(connectorPublishIds([...raw.map(connectorCoverageId), 'github:org/repo:42'])).toEqual(raw);
  });
  it('uses the selected company adapter and explicit connection in the existing runtime', async () => {
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true');
    vi.mocked(invokeCapability).mockResolvedValue({ ok: true, invocation: { status: 'succeeded', output: { version: 1, items: [], warnings: [] } } } as never);
    await listConnectorItems(viewer, 'one', binding, new Date(input.coverageStart), new Date(input.coverageEnd));
    expect(websiteAdapter).toHaveBeenCalledWith(connection.config);
    expect(invokeCapability).toHaveBeenCalledWith(viewer, 'one', 'content.items.list', expect.anything(), expect.objectContaining({ connectionId: binding.connectionId }));
  });
  it('exposes ambiguous publication and retries identical payload and key without fallback', async () => {
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true');
    vi.mocked(invokeCapability).mockResolvedValue({ ok: true, invocation: { status: 'failed', error: 'Uncertain write' } } as never);
    await expect(publishConnectorSnapshot(viewer, 'one', binding, input)).rejects.toThrow('Uncertain write');
    await expect(publishConnectorSnapshot(viewer, 'one', binding, input)).rejects.toThrow('Uncertain write');
    expect(invokeCapability).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(invokeCapability).mock.calls) {
      expect(call[3]).toEqual(input); expect(call[4]).toMatchObject({ connectionId: binding.connectionId, idempotencyKey: input.idempotencyKey });
      expect(call[4]?.registry?.find(def => def.id === 'content.posts.publish')?.approval).toBe('auto');
    }
  });
  it('collects bounded pages in the identical source window and canonicalizes baseline comparison', async () => {
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true');
    const baseline = { publishedAt: input.coverageStart, coverageEnd: null, coveredIds: ['b', 'a'] };
    vi.mocked(invokeCapability)
      .mockResolvedValueOnce({ ok: true, invocation: { status: 'succeeded', output: { version: 1, items: [], warnings: ['one'], baseline, nextCursor: 'page2' } } } as never)
      .mockResolvedValueOnce({ ok: true, invocation: { status: 'succeeded', output: { version: 1, items: [], warnings: ['two'], baseline: { ...baseline, coveredIds: ['a', 'b'] } } } } as never);
    const result = await listConnectorItems(viewer, 'one', binding, new Date(input.coverageStart), new Date(input.coverageEnd));
    expect(result.warnings).toEqual(['one', 'two']);
    expect(vi.mocked(invokeCapability).mock.calls[1][3]).toEqual({ since: input.coverageStart, until: input.coverageEnd, cursor: 'page2' });
  });
  it.each(['duplicate', 'cycle', 'baseline', 'overflow'])('rejects incomplete pagination: %s', async scenario => {
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true');
    let page = 0;
    const item = { id: 'same', kind: 'article', title: 'Article', url: 'https://one.example.com/article', publishedAt: input.coverageStart, publicationBasis: 'first_published', fields: {} };
    vi.mocked(invokeCapability).mockImplementation(async () => {
      page++;
      return { ok: true, invocation: { status: 'succeeded', output: { version: 1,
        items: scenario === 'duplicate' ? [item] : [], warnings: [],
        baseline: { publishedAt: scenario === 'baseline' && page > 1 ? input.coverageEnd : input.coverageStart, coverageEnd: null, coveredIds: [] },
        nextCursor: scenario === 'cycle' ? 'same' : `page${page + 1}` } } } as never;
    });
    await expect(listConnectorItems(viewer, 'one', binding, new Date(input.coverageStart), new Date(input.coverageEnd))).rejects.toThrow(/Coverage unchanged/);
    expect(page).toBeLessThanOrEqual(5);
  });
});
