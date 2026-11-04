import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
vi.mock('@/lib/db/mongodb', () => ({ default: async () => mongoose }));
import { startDesktopGrant, readDesktopGrant, approveDesktopGrant, consumeDesktopGrant } from './desktopGrant';
let db: MongoMemoryServer;
beforeAll(async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri('desktop_auth_test'));
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
describe('Desktop authentication handoff', () => {
    it('requires browser approval and the original native proof, and consumes only once', async () => {
        const grant = await startDesktopGrant();
        expect(await consumeDesktopGrant(grant.requestId, grant.proof)).toBeNull();
        expect(await approveDesktopGrant(grant.requestId, 'user-a')).not.toBeNull();
        expect(await approveDesktopGrant(grant.requestId, 'user-b')).toBeNull();
        expect(await consumeDesktopGrant(grant.requestId, 'wrong')).toBeNull();
        const results = await Promise.all([consumeDesktopGrant(grant.requestId, grant.proof), consumeDesktopGrant(grant.requestId, grant.proof)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(results.find(Boolean).userId).toBe('user-a');
        expect(await consumeDesktopGrant(grant.requestId, grant.proof)).toBeNull();
    });
    it('rejects expired requests even before Mongo TTL cleanup', async () => {
        const grant = await startDesktopGrant();
        await mongoose.models.DesktopGrant.updateOne({ requestId: grant.requestId }, { $set: { expiresAt: new Date(0), userId: 'user' } });
        expect(await readDesktopGrant(grant.requestId)).toBeNull();
        expect(await approveDesktopGrant(grant.requestId, 'user')).toBeNull();
        expect(await consumeDesktopGrant(grant.requestId, grant.proof)).toBeNull();
    });
    it('stores only a hash of the proof and keeps requests isolated', async () => {
        const a = await startDesktopGrant(), b = await startDesktopGrant();
        const saved = await readDesktopGrant(a.requestId);
        expect(saved.proofHash).not.toBe(a.proof);
        expect(JSON.stringify(saved)).not.toContain(a.proof);
        await approveDesktopGrant(a.requestId, 'user-a');
        expect(await consumeDesktopGrant(a.requestId, b.proof)).toBeNull();
    });
});
