import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const state = vi.hoisted(() => ({ workerConfigured: true, row: null as null | Record<string, unknown>, domain: 'playbound.club' as string | undefined }));

vi.mock('server-only', () => ({}));
vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-'.repeat(4));
vi.mock('@/lib/ai/tools/browseRouter', () => ({ isBrowserWorkerConfigured: () => state.workerConfigured }));
vi.mock('@/lib/ai/tools/ssrf', () => ({ assertSafePublicHttpsUrl: (u: string) => new URL(u) }));
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserObserve: async () => ({ url: 'https://playbound.club/x', title: 'T', loggedIn: true, text: 'OpenHV', note: '' }), browserWorkerCall: vi.fn() }));
vi.mock('@/lib/companies/companyProfile', () => ({ getCompanyProfile: async () => ({ id: 'c', domain: state.domain }), isCompanyManager: () => true }));
vi.mock('@/lib/companies/activityLog', () => ({ recordActivity: async () => undefined }));
vi.mock('@/lib/models/CompanyAdminAccount', () => ({ CompanyAdminAccount: { findOne: () => ({ lean: async () => state.row }) } }));

import { sealSecret } from '@/lib/security/secretBox';
import { observePageForRequest } from './adminAccount';

const viewer = { userId: 'u', organizationId: new Types.ObjectId(), employeeId: null, role: 'Manager' as const };
const companyId = new Types.ObjectId().toHexString();
const ask = 'On playbound.club/admin/connect/game-servers, OpenHV is listed twice.';

describe('observePageForRequest says why the live page was not checked', () => {
  beforeEach(() => { state.workerConfigured = true; state.row = null; state.domain = 'playbound.club'; });

  it('is silent only when the request names no page on the company’s site', async () => {
    expect(await observePageForRequest(viewer, companyId, 'How is revenue doing?')).toBeNull();
    state.domain = undefined;
    expect(await observePageForRequest(viewer, companyId, ask)).toBeNull();
  });

  it('names the missing piece: no session, unconfigured worker, expired session', async () => {
    expect(await observePageForRequest(viewer, companyId, ask)).toEqual({ failure: expect.stringContaining('no admin account session is connected') });
    state.workerConfigured = false;
    expect(await observePageForRequest(viewer, companyId, ask)).toEqual({ failure: expect.stringContaining('browser worker is not configured') });
    state.workerConfigured = true;
    state.row = { baseUrl: 'https://playbound.club', sessionSealed: sealSecret(`company-admin-session:${companyId}`, '[]'), expiresAt: new Date(Date.now() - 1000) };
    expect(await observePageForRequest(viewer, companyId, ask)).toEqual({ failure: expect.stringContaining('expired') });
  });

  it('opens the page when everything is in place', async () => {
    state.row = { baseUrl: 'https://playbound.club', sessionSealed: sealSecret(`company-admin-session:${companyId}`, JSON.stringify([{ name: 's', value: 'v', domain: 'playbound.club', path: '/', expires: -1 }])) };
    expect(await observePageForRequest(viewer, companyId, ask)).toMatchObject({ text: 'OpenHV' });
  });
});
