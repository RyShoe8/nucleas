import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const worker = vi.hoisted(() => ({ calls: [] as { path: string; body: Record<string, unknown> }[], stored: null as unknown }));

vi.mock('server-only', () => ({}));
vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-'.repeat(4));
vi.mock('@/lib/ai/tools/browseRouter', () => ({ isBrowserWorkerConfigured: () => true }));
vi.mock('@/lib/ai/tools/ssrf', () => ({ assertSafePublicHttpsUrl: (u: string) => new URL(u) }));
vi.mock('@/lib/ai/tools/browserClient', () => ({
  browserObserve: vi.fn(),
  browserWorkerCall: async (path: string, body: Record<string, unknown>) => {
    worker.calls.push({ path, body });
    if (path === '/login/start') return { sessionId: 'w1', width: 1000, height: 640 };
    if (path === '/login/frame') return { image: 'AAAA', url: 'https://site.example/', title: 'Login' };
    if (path === '/login/finish') return { cookies: [{ name: 'session', value: 'abc', domain: 'site.example', path: '/', expires: -1 }, { name: 'ga', value: '1', domain: '.google.com', path: '/', expires: -1 }] };
    return { ok: true };
  },
}));
vi.mock('@/lib/companies/companyProfile', () => ({
  getCompanyProfile: async () => ({ id: 'c1' }),
  isCompanyManager: (v: { role: string }) => v.role !== 'User',
}));
vi.mock('@/lib/companies/activityLog', () => ({ recordActivity: async () => undefined }));
vi.mock('@/lib/models/CompanyAdminAccount', () => ({
  CompanyAdminAccount: {
    findOneAndUpdate: (_f: unknown, update: { $set: Record<string, unknown> }) => {
      worker.stored = update.$set;
      return { lean: async () => ({ organizationId: new Types.ObjectId() }) };
    },
  },
}));

import { loginFinish, loginFrame, loginInput, loginStart } from './adminAccount';

const viewer = (userId: string, role: 'Manager' | 'User' = 'Manager') => ({ userId, organizationId: new Types.ObjectId(), employeeId: null, role });
const companyId = new Types.ObjectId().toHexString();

describe('logging in through a window inside Nucleas', () => {
  beforeEach(() => { worker.calls = []; worker.stored = null; });

  it('is for managers only', async () => {
    expect(await loginStart(viewer('u1', 'User'), companyId, 'site.example')).toMatchObject({ ok: false, status: 403 });
  });

  it('hands the page an opaque handle that only its owner, for that company, can use', async () => {
    const started = await loginStart(viewer('u1'), companyId, 'https://site.example/admin');
    if (!started.ok) throw new Error('start failed');
    expect(started.baseUrl).toBe('https://site.example');
    expect(started.handle).not.toContain('w1');
    expect(await loginFrame(viewer('u1'), companyId, started.handle)).toMatchObject({ ok: true, image: 'AAAA' });
    expect(await loginFrame(viewer('u2'), companyId, started.handle)).toMatchObject({ ok: false });
    expect(await loginInput(viewer('u1'), 'other-company', started.handle, { type: 'click', x: 1, y: 1 })).toMatchObject({ ok: false });
    expect(worker.calls.filter((c) => c.path === '/login/frame')).toHaveLength(1);
  });

  it('saves only the site’s own cookies, sealed, when the person says they are logged in', async () => {
    const started = await loginStart(viewer('u1'), companyId, 'site.example');
    if (!started.ok) throw new Error('start failed');
    expect(await loginFinish(viewer('u1'), companyId, started.handle)).toEqual({ ok: true });
    const saved = worker.stored as { sessionSealed: string; cookieCount: number; baseUrl: string };
    expect(saved.cookieCount).toBe(1);
    expect(saved.baseUrl).toBe('https://site.example');
    expect(saved.sessionSealed.startsWith('v1.')).toBe(true);
    expect(saved.sessionSealed).not.toContain('abc');
  });
});
