import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  role: 'Administrator' as 'Administrator' | 'Manager' | 'User',
  profile: vi.fn(),
  updateOne: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/companies/osRouteContext', () => ({
  requireCompanyViewer: async () => ({ userId: 'a'.repeat(24), organizationId: 'b'.repeat(24), employeeId: null, role: mocks.role }),
}));
vi.mock('@/lib/companies/companyProfile', () => ({
  getCompanyProfile: (...args: unknown[]) => mocks.profile(...args),
  isCompanyManager: (viewer: { role: string }) => viewer.role === 'Administrator' || viewer.role === 'Manager',
}));
vi.mock('@/lib/integrations/connections', () => ({ addConnection: vi.fn(), listAddableProviders: vi.fn() }));
vi.mock('@/lib/metrics/siteHistory', () => ({ refetchSiteHistory: (...args: unknown[]) => mocks.refetch(...args) }));
vi.mock('@/lib/models/Integration', () => ({ IntegrationConnection: { updateOne: (...args: unknown[]) => mocks.updateOne(...args) } }));

import { PATCH } from './route';

const companyId = 'd'.repeat(24);
const patch = (body: unknown) => PATCH(
  new NextRequest(`https://os.nucleas.test/api/os/companies/${companyId}/connections`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: companyId }) },
);

describe('assigning an account to websites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'Administrator';
    mocks.profile.mockResolvedValue({ id: companyId, websites: ['frugalgambler.club', 'dealsblog.example'] });
    mocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it('saves the company websites it names, matching www. to the bare domain', async () => {
    const response = await patch({ provider: 'mailchimp', sites: ['www.frugalgambler.club', 'dealsblog.example', 'frugalgambler.club'] });
    expect(await response.json()).toEqual({ ok: true, sites: ['frugalgambler.club', 'dealsblog.example'] });
    expect(mocks.updateOne).toHaveBeenCalledWith(expect.objectContaining({ provider: 'mailchimp' }), { $set: { sites: ['frugalgambler.club', 'dealsblog.example'] } });
    // Past days are fetched again so the site shows its history, not just from today.
    expect(mocks.refetch).toHaveBeenCalledWith('b'.repeat(24), companyId);
  });

  it('clears the assignment with an empty list', async () => {
    await patch({ provider: 'stripe', sites: [] });
    expect(mocks.updateOne).toHaveBeenCalledWith(expect.anything(), { $unset: { sites: '' } });
  });

  it('refuses a website the company does not have', async () => {
    const response = await patch({ provider: 'stripe', sites: ['someoneelse.example'] });
    expect(response.status).toBe(400);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('refuses users who are not managers, and accounts that are not connected', async () => {
    mocks.role = 'User';
    expect((await patch({ provider: 'stripe', sites: [] })).status).toBe(403);
    mocks.role = 'Manager';
    mocks.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    expect((await patch({ provider: 'stripe', sites: [] })).status).toBe(404);
  });
});
