import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ company: vi.fn(), users: vi.fn(), access: vi.fn(), vision: vi.fn() }));
vi.mock('@/lib/ai/attachments/describeImage', () => ({ describeImage: mocks.vision }));
vi.mock('@/lib/companies/companyProfile', () => ({ getCompanyProfile: mocks.company }));
vi.mock('@/lib/utils/apiHelpers', () => ({ getOrganizationUserIds: mocks.users }));
vi.mock('@/lib/assets/assetAccess', () => ({ getAssetSessionContext: mocks.access, buildAssetAccessScope: async () => ({}), canAccessAsset: () => false }));
import Asset from '@/lib/models/Asset';
import { workAssets, linkWorkAssets, workResourceContext } from './resources';
const uid = new Types.ObjectId(), org = new Types.ObjectId(), company = new Types.ObjectId(), otherCompany = new Types.ObjectId();
const viewer = { userId: String(uid), organizationId: org, employeeId: null, role: 'Administrator' as const };
let mongo: MongoMemoryServer;
beforeAll(async () => { mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } }); await mongoose.connect(mongo.getUri('work_resources_test')); }, 120_000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Asset.deleteMany({}); mocks.company.mockResolvedValue({ id: String(company) }); mocks.users.mockResolvedValue([uid]); mocks.access.mockResolvedValue({ isManagerOrAdmin: true }); });
it('carries a private Ask file into exactly one company and preserves readable evidence', async () => {
    const a = await Asset.create({ name: 'Reference.txt', type: 'file', userId: uid, tags: ['work-attachment'], fileUrl: 'data:text/plain;base64,' + Buffer.from('Exact facts from the uploaded source.').toString('base64') });
    const ids = [String(a._id)];
    expect((await workAssets(viewer, String(company), ids))).toHaveLength(1);
    await linkWorkAssets(viewer, String(company), ids);
    expect(String((await Asset.findById(a._id))?.linkedClientId)).toBe(String(company));
    expect(await workResourceContext(viewer, String(company), { assetIds: ids, sources: ['https://example.org/report'] })).toContain('Exact facts from the uploaded source.');
    await expect(workAssets(viewer, String(otherCompany), ids)).rejects.toThrow('not accessible');
});
it('rejects other organizations, other companies, unmarked private files and inaccessible records', async () => {
    for (const extra of [{ userId: new Types.ObjectId(), linkedClientId: company }, { linkedClientId: otherCompany }, {}]) {
        const a = await Asset.create({ name: 'Private', type: 'text', userId: uid, ...extra });
        await expect(workAssets(viewer, String(company), [String(a._id)])).rejects.toThrow('not accessible');
    }
    const a = await Asset.create({ name: 'Protected', type: 'text', userId: uid, linkedClientId: company });
    mocks.access.mockResolvedValue({ isManagerOrAdmin: false });
    await expect(workAssets(viewer, String(company), [String(a._id)])).rejects.toThrow('not accessible');
});
it('lists metadata without loading file bodies and fails closed if a reference was deleted', async () => {
    const a = await Asset.create({ name: 'Reference', type: 'text', userId: uid, linkedClientId: company, textContent: 'long evidence', fileUrl: 'data:text/plain;base64,eA==' });
    const list = await workAssets(viewer, String(company), null);
    expect(list[0].fileUrl).toBeUndefined(); expect(list[0].textContent).toBeUndefined();
    await a.deleteOne();
    await expect(workResourceContext(viewer, String(company), { assetIds: [String(a._id)], sources: [] })).rejects.toThrow('missing');
});
it('reads an image through free vision once and reuses the description on later runs', async () => {
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const a = await Asset.create({ name: 'Reference.png', type: 'file', userId: uid, linkedClientId: company, fileUrl: 'data:image/png;base64,' + bytes.toString('base64') });
    mocks.vision.mockResolvedValue({ ok: true, text: 'A white square.', model: 'free-vision', costMicros: 0 });
    const agreement = { assetIds: [String(a._id)], sources: [] };
    expect(await workResourceContext(viewer, String(company), agreement)).toContain('A white square.');
    expect(await workResourceContext(viewer, String(company), agreement)).toContain('A white square.');
    expect(mocks.vision).toHaveBeenCalledTimes(1); expect(mocks.vision).toHaveBeenCalledWith(expect.objectContaining({ level: 'free' }));
});
