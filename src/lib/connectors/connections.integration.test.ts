import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { ReleaseRoundup } from '@/lib/models/ReleaseRoundup';
import { openSecret } from '@/lib/security/secretBox';
import { getWebsiteConnection, getPinnedWebsiteConnection, saveWebsiteConnection, testWebsiteConnection, websiteConnectionView } from './connections';
import { removeConnection } from '@/lib/integrations/connections';
import type { CompanyViewer } from '@/lib/companies/companyProfile';
import type { WebsiteConnectorConfig } from './contracts';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('./adapters', () => ({ websiteAdapter: () => ({ list: mocks.list }) }));
vi.mock('@/lib/companies/companyProfile', () => ({ getCompanyProfile: async (_viewer: CompanyViewer, id: string) => id === 'a'.repeat(24) ? { id, domain: 'games.acme.com' } : null, isCompanyManager: (viewer: CompanyViewer) => viewer.role === 'Administrator' }));
const org = new Types.ObjectId();
const companyId = 'a'.repeat(24);
const admin: CompanyViewer = { organizationId: org, userId: String(new Types.ObjectId()), employeeId: null, role: 'Administrator' };
const config: WebsiteConnectorConfig = { version: 1, adapter: 'website-v1', origin: 'https://games.acme.com', endpointPath: '/api/nucleas/v1', enabled: false, permissions: ['content.items.list', 'content.posts.publish'], collection: 'games' };
const credential = 'test-only-signing-key-1234567890';
let replica: MongoMemoryReplSet;
beforeAll(async () => {
  vi.stubEnv('NUCLEAS_SECRETS_KEY', 'connector-test-master');
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('website_connections_test'));
  await IntegrationConnection.syncIndexes();
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await replica?.stop(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'false');
  mocks.list.mockReset().mockResolvedValue({ version: 1, items: [{ id: 'game-1', title: 'New game', url: 'https://games.acme.com/game/1' }], warnings: [] });
  await Promise.all([IntegrationConnection.deleteMany({}), IntegrationSecret.deleteMany({}), ReleaseRoundup.deleteMany({})]);
});
describe('prepared website connections', () => {
  it('stores encrypted credentials disabled and never exposes secret material in the view', async () => {
    const view = await saveWebsiteConnection(admin, companyId, { config, credential });
    expect(view.connection?.config.enabled).toBe(false);
    expect(view.connection?.testOk).toBe(false);
    expect(JSON.stringify(view)).not.toContain(credential);
    const secret = await IntegrationSecret.findOne({}).select('+sealed').lean();
    expect(secret?.sealed).not.toContain(credential);
    expect(openSecret('integration:website', secret!.sealed)).toBe(credential);
    expect(await getWebsiteConnection(admin, companyId)).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('tests only by reading and requires rollout plus a matching successful test before enabling', async () => {
    const view = await saveWebsiteConnection(admin, companyId, { config, credential });
    await expect(saveWebsiteConnection(admin, companyId, { config: { ...config, enabled: true }, expectedRevision: view.connection!.revision })).rejects.toMatchObject({ status: 409 });
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true');
    await expect(saveWebsiteConnection(admin, companyId, { config: { ...config, enabled: true }, expectedRevision: view.connection!.revision })).rejects.toMatchObject({ status: 409 });
    const tested = await testWebsiteConnection(admin, companyId);
    expect(tested.readOnly).toBe(true);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(tested.view.connection?.testOk).toBe(true);
    const enabled = await saveWebsiteConnection(admin, companyId, { config: { ...config, enabled: true }, expectedRevision: tested.view.connection!.revision });
    const selected = await getWebsiteConnection(admin, companyId);
    expect(selected?.connectionId).toBe(enabled.connection!.id);
    expect(selected?.credential).toBe(credential);
  });
  it('prevents stale revisions, wrong origins, unauthorized configuration and cross-organization reads', async () => {
    await saveWebsiteConnection(admin, companyId, { config, credential });
    await expect(saveWebsiteConnection(admin, companyId, { config, expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(saveWebsiteConnection(admin, companyId, { config: { ...config, origin: 'https://another.acme.com' }, credential })).rejects.toMatchObject({ status: 400 });
    await expect(saveWebsiteConnection({ ...admin, role: 'User' }, companyId, { config, credential })).rejects.toMatchObject({ status: 403 });
    expect((await websiteConnectionView({ ...admin, organizationId: new Types.ObjectId() }, companyId)).connection).toBeNull();
  });
  it('keeps a pinned revision stable through pause/resume and blocks changed pending destinations', async () => {
    await saveWebsiteConnection(admin, companyId, { config, credential });
    await testWebsiteConnection(admin, companyId);
    vi.stubEnv('NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED', 'true');
    const prepared = await websiteConnectionView(admin, companyId);
    const enabled = await saveWebsiteConnection(admin, companyId, { config: { ...config, enabled: true }, expectedRevision: prepared.connection!.revision });
    const binding = { connectionId: enabled.connection!.id, revision: enabled.connection!.revision, origin: config.origin };
    await ReleaseRoundup.create({ organizationId: org, companyId, createdByUserId: admin.userId, status: 'draft', active: true, idempotencyKey: 'key', transport: { kind: 'connector', ...binding } });
    expect(await removeConnection(admin, binding.connectionId)).toMatchObject({ ok: false, status: 409 });
    expect((await IntegrationConnection.findById(binding.connectionId).lean())?.secretId).toBeDefined();
    await expect(saveWebsiteConnection(admin, companyId, { config: { ...config, collection: 'other' }, expectedRevision: binding.revision })).rejects.toMatchObject({ status: 409 });
    await saveWebsiteConnection(admin, companyId, { config, expectedRevision: binding.revision });
    await expect(getPinnedWebsiteConnection(admin, companyId, binding)).rejects.toMatchObject({ status: 409 });
    await saveWebsiteConnection(admin, companyId, { config: { ...config, enabled: true }, expectedRevision: binding.revision });
    expect((await getPinnedWebsiteConnection(admin, companyId, binding)).revision).toBe(binding.revision);
    await expect(getPinnedWebsiteConnection(admin, companyId, { ...binding, revision: 99 })).rejects.toMatchObject({ status: 409 });
  });
});
