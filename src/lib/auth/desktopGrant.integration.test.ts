import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
vi.mock('@/lib/db/mongodb', () => ({ default: async () => mongoose }));
import { startDesktopGrant, readDesktopGrant, approveDesktopGrant, consumeDesktopGrant, completeDesktopGrant } from './desktopGrant';
import { createDesktopSession, renewDesktopSession, revokeDesktopSession } from './desktopSession';
import User from '@/lib/models/User';
let db: MongoMemoryServer;
beforeAll(async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri('desktop_auth_test'));
}, 120000);
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
describe('Desktop authentication handoff', () => {
    it('requires both the native proof and the one-time local callback, without manual approval', async () => {
        const grant = await startDesktopGrant({ port: 43210, nonce: 'a'.repeat(64) });
        expect(await approveDesktopGrant(grant.requestId, 'victim')).toBeNull();
        const callback = new URL((await completeDesktopGrant(grant.requestId, 'user-local'))!);
        expect(callback.origin).toBe('http://127.0.0.1:43210');
        expect(callback.pathname).toBe('/nucleas-auth/' + 'a'.repeat(64));
        expect(await consumeDesktopGrant(grant.requestId, grant.proof)).toBeNull();
        expect(await consumeDesktopGrant(grant.requestId, grant.proof, 'b'.repeat(64))).toBeNull();
        expect(await consumeDesktopGrant(grant.requestId, 'c'.repeat(64), callback.searchParams.get('code')!)).toBeNull();
        const consumed = await consumeDesktopGrant(grant.requestId, grant.proof, callback.searchParams.get('code')!);
        expect(consumed.userId).toBe('user-local');
        expect(await completeDesktopGrant(grant.requestId, 'other')).toBeNull();
        expect(await consumeDesktopGrant(grant.requestId, grant.proof, callback.searchParams.get('code')!)).toBeNull();
    });
    it('rejects invalid local callback destinations', async () => {
        for (const port of [0, 80, 65536, 43210.5]) await expect(startDesktopGrant({ port, nonce: 'a'.repeat(64) })).rejects.toThrow();
        await expect(startDesktopGrant({ port: 43210, nonce: '../callback' })).rejects.toThrow();
    });
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

describe('Remembered desktop sessions', () => {
    async function user() { return User.create({ email: `${new mongoose.Types.ObjectId()}@example.test`, password: 'synthetic-password-hash', organizationId: String(new mongoose.Types.ObjectId()), emailVerified: true }); }
    it('stores only a credential hash, renews expiry, and revokes this device without revoking another', async () => {
        const account = await user();
        const first = (await createDesktopSession(String(account._id)))!, second = (await createDesktopSession(String(account._id)))!;
        expect(JSON.stringify(await mongoose.models.DesktopSession.findById(first.id))).not.toContain(first.token);
        await mongoose.models.DesktopSession.updateOne({ _id: first.id }, { $set: { expiresAt: new Date(Date.now() + 60000) } });
        expect((await renewDesktopSession(first.token))!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * 86400000);
        await revokeDesktopSession(first.id, String(account._id));
        expect(await renewDesktopSession(first.token)).toBeNull();
        expect(await renewDesktopSession(second.token)).not.toBeNull();
    });
    it('rejects expired, deleted, rejected and password-changed accounts', async () => {
        for (const change of ['expired', 'deleted', 'rejected', 'password']) {
            const account = await user(), device = (await createDesktopSession(String(account._id)))!;
            if (change === 'expired') await mongoose.models.DesktopSession.updateOne({ _id: device.id }, { $set: { expiresAt: new Date(0) } });
            if (change === 'deleted') await User.deleteOne({ _id: account._id });
            if (change === 'rejected') await User.updateOne({ _id: account._id }, { $set: { registrationApproval: 'rejected' } });
            if (change === 'password') await User.updateOne({ _id: account._id }, { $set: { password: 'different-synthetic-hash' } });
            expect(await renewDesktopSession(device.token)).toBeNull();
        }
    });
});
