import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { NextRequest } from 'next/server';
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock('next/headers', () => ({ cookies: async () => ({
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) => jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name),
}) }));
vi.mock('@/lib/db/mongodb', () => ({ default: async () => mongoose }));
vi.mock('@/lib/security/rateLimit', () => ({ enforceRateLimit: () => null, rateLimitKey: () => 'synthetic' }));
vi.mock('@/lib/services/brevoContactSync', () => ({ syncRegisteredUserToBrevoInBackground: vi.fn(), syncUserToBrevoInBackground: vi.fn() }));
import User from '@/lib/models/User';
import { GET, POST } from '@/app/api/auth/desktop/route';
import { GET as complete } from '@/app/api/auth/desktop/complete/route';
import { GET as google } from '@/app/api/auth/google/route';
import { GET as googleCallback } from '@/app/api/auth/google/callback/route';
import { createSession, deleteSession } from './session';
import { startDesktopGrant } from './desktopGrant';
import { createDesktopSession, renewDesktopSession, DESKTOP_REFRESH_COOKIE } from './desktopSession';
import { verifyLoginOAuthState } from './loginOauthState';

let db: MongoMemoryServer;
beforeAll(async () => { db = await MongoMemoryServer.create(); await mongoose.connect(db.getUri('desktop_route_test')); }, 120000);
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(() => { jar.clear(); });
const request = (path: string, body?: unknown, cookie?: string) => new NextRequest(`https://nucleas.app${path}`, { headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
const account = () => User.create({ email: `${new mongoose.Types.ObjectId()}@example.test`, password: 'synthetic-hash', organizationId: String(new mongoose.Types.ObjectId()), emailVerified: true });
const grant = () => startDesktopGrant({ port: 43210, nonce: 'a'.repeat(64) });

describe('Desktop sign-in routes', () => {
    it('goes directly to Google, permits email, skips both when already signed in, and preserves old launchers', async () => {
        const g = await grant(), path = `/api/auth/desktop?request=${g.requestId}`;
        expect((await GET(request(path))).headers.get('location')).toBe('https://nucleas.app/api/auth/google');
        expect((await GET(request(path + '&method=email'))).headers.get('location')).toBe('https://nucleas.app/login');
        const user = await account(); await createSession(String(user._id), user.email);
        expect((await GET(request(path))).headers.get('location')).toBe(`https://nucleas.app/api/auth/desktop/complete?request=${g.requestId}`);
        const legacy = await startDesktopGrant();
        expect((await GET(request(`/api/auth/desktop?request=${legacy.requestId}`))).headers.get('location')).toContain('/desktop/connect?');
    });
    it('completes only in the initiating browser, exchanges once, remembers the device, and honors logout', async () => {
        const user = await account(), g = await grant(); await createSession(String(user._id), user.email);
        const path = `/api/auth/desktop/complete?request=${g.requestId}`;
        expect((await complete(request(path))).status).toBe(401);
        const returned = await complete(request(path, undefined, `desktop-login-return=${g.requestId}`));
        const callback = new URL(returned.headers.get('location')!);
        expect(callback.origin).toBe('http://127.0.0.1:43210');
        const body = { action: 'exchange', requestId: g.requestId, proof: g.proof, callbackCode: callback.searchParams.get('code') };
        const response = await POST(request('/api/auth/desktop', body));
        expect(response.status).toBe(200);
        const refresh = jar.get(DESKTOP_REFRESH_COOKIE)!;
        expect(refresh.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth/desktop' });
        expect(JSON.stringify(await response.json())).not.toContain(refresh.value);
        expect((await POST(request('/api/auth/desktop', body))).status).toBe(202);
        expect(await renewDesktopSession(refresh.value)).not.toBeNull();
        await deleteSession();
        expect(await renewDesktopSession(refresh.value)).toBeNull();
        expect(jar.get('session')).toBeUndefined();
        expect(jar.get(DESKTOP_REFRESH_COOKIE)!.options?.maxAge).toBe(0);
    });
    it('upgrades installed sessions, renews with an expired access cookie, and never falls back after a rejected refresh', async () => {
        const user = await account(); await createSession(String(user._id), user.email);
        expect((await POST(request('/api/auth/desktop', { action: 'refresh' }))).status).toBe(200);
        const token = jar.get(DESKTOP_REFRESH_COOKIE)!.value;
        jar.delete('session');
        expect((await POST(request('/api/auth/desktop', { action: 'refresh' }, `${DESKTOP_REFRESH_COOKIE}=${token}`))).status).toBe(200);
        await createSession(String(user._id), user.email);
        expect((await POST(request('/api/auth/desktop', { action: 'refresh' }, `${DESKTOP_REFRESH_COOKIE}=${'0'.repeat(64)}`))).status).toBe(401);
    });
    it('rejects cross-site requests and unapproved accounts', async () => {
        const crossSite = request('/api/auth/desktop', { action: 'refresh' }); crossSite.headers.set('origin', 'https://foreign.example');
        expect((await POST(crossSite)).status).toBe(403);
        const user = await account(), g = await grant(), device = (await createDesktopSession(String(user._id)))!;
        await createSession(String(user._id), user.email); await User.updateOne({ _id: user._id }, { $set: { registrationApproval: 'rejected' } });
        expect((await complete(request(`/api/auth/desktop/complete?request=${g.requestId}`, undefined, `desktop-login-return=${g.requestId}`))).status).toBe(403);
        expect((await POST(request('/api/auth/desktop', { action: 'refresh' }, `${DESKTOP_REFRESH_COOKIE}=${device.token}`))).status).toBe(401);
    });
    it('binds Google state to this browser and avoids repeated consent in the desktop flow', async () => {
        vi.stubEnv('GOOGLE_CLIENT_ID', 'synthetic-client');
        try {
            const g = await grant();
            const response = await google(request('/api/auth/google', undefined, `desktop-login-return=${g.requestId}`));
            const destination = new URL(response.headers.get('location')!), state = destination.searchParams.get('state')!;
            expect(destination.searchParams.has('prompt')).toBe(false);
            expect(response.cookies.get('desktop-oauth-state')?.value).toBe(state);
            expect((await verifyLoginOAuthState(state))?.desktopRequestId).toBe(g.requestId);
            const rejected = await googleCallback(request(`/api/auth/google/callback?code=synthetic&state=${encodeURIComponent(state)}`));
            expect(rejected.headers.get('location')).toBe('https://nucleas.app/login?error=invalid_state');
            const user = await account();
            vi.stubEnv('GOOGLE_CLIENT_SECRET', 'synthetic-secret');
            const googleFetch = vi.fn()
                .mockResolvedValueOnce(Response.json({ access_token: 'synthetic-google-token' }))
                .mockResolvedValueOnce(Response.json({ id: 'synthetic-google-id', email: user.email, name: 'Fixture user' }));
            vi.stubGlobal('fetch', googleFetch);
            const accepted = await googleCallback(request(`/api/auth/google/callback?code=synthetic&state=${encodeURIComponent(state)}`, undefined, `desktop-oauth-state=${state}; desktop-login-return=${g.requestId}`));
            expect(accepted.headers.get('location')).toBe(`https://nucleas.app/api/auth/desktop/complete?request=${g.requestId}`);
            expect(jar.get('session')?.value).toBeTruthy();
            expect(googleFetch).toHaveBeenCalledTimes(2);
        } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
    });
});
