import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  role: 'Administrator' as 'Administrator' | 'Manager' | 'User',
  findCompany: vi.fn(),
  save: vi.fn(),
  activity: vi.fn(),
  profile: vi.fn(),
  projects: vi.fn(),
  connections: vi.fn(),
  citations: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/companies/osRouteContext', () => ({
  requireCompanyViewer: async () => ({ userId: 'a'.repeat(24), organizationId: 'b'.repeat(24), employeeId: 'c'.repeat(24), role: mocks.role }),
}));
vi.mock('@/lib/companies/companyProfile', () => ({
  getCompanyProfile: (...args: unknown[]) => mocks.profile(...args),
  isCompanyManager: (viewer: { role: string }) => viewer.role === 'Administrator' || viewer.role === 'Manager',
}));
vi.mock('@/lib/models/Client', () => ({ default: { findOne: (...args: unknown[]) => mocks.findCompany(...args) } }));
vi.mock('@/lib/models/Project', () => ({ default: { aggregate: (...args: unknown[]) => mocks.projects(...args) } }));
vi.mock('@/lib/models/CompanyAssistantTurn', () => ({ CompanyAssistantTurn: { aggregate: (...args: unknown[]) => mocks.citations(...args) } }));
vi.mock('@/lib/integrations/connections', () => ({ listCompanyConnections: (...args: unknown[]) => mocks.connections(...args) }));
vi.mock('@/lib/companies/activityLog', () => ({ recordActivity: (...args: unknown[]) => mocks.activity(...args) }));

import { GET, PATCH } from './route';

const companyId = 'd'.repeat(24);
const request = (domain: unknown) => new NextRequest(`https://os.nucleas.test/api/os/companies/${companyId}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain }),
});

describe('company production domain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'Administrator';
    mocks.save.mockResolvedValue(undefined);
    mocks.activity.mockResolvedValue(undefined);
    mocks.profile.mockResolvedValue({ id: companyId, name: 'PlayBound', relationship: 'owned' });
    mocks.projects.mockResolvedValue([]);
    mocks.connections.mockResolvedValue([]);
    mocks.citations.mockResolvedValue([{ count: 17 }]);
  });

  it('normalizes and saves a production URL as the canonical hostname', async () => {
    const company = { domain: undefined as string | undefined, save: mocks.save };
    mocks.findCompany.mockResolvedValue(company);
    const response = await PATCH(request('https://www.SeniorByDesign.com/'), { params: Promise.resolve({ id: companyId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ domain: 'seniorbydesign.com' });
    expect(company.domain).toBe('seniorbydesign.com');
    expect(mocks.findCompany).toHaveBeenCalledWith({ _id: companyId, organizationId: 'b'.repeat(24) });
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ title: 'Production domain set', detail: 'seniorbydesign.com' }));
  });

  it('rejects paths and does not write', async () => {
    const response = await PATCH(request('https://seniorbydesign.com/admin'), { params: Promise.resolve({ id: companyId }) });
    expect(response.status).toBe(400);
    expect(mocks.findCompany).not.toHaveBeenCalled();
  });

  it('allows only managers and administrators', async () => {
    mocks.role = 'User';
    const response = await PATCH(request('seniorbydesign.com'), { params: Promise.resolve({ id: companyId }) });
    expect(response.status).toBe(403);
    expect(mocks.findCompany).not.toHaveBeenCalled();
  });

  it('returns the company AI citation count for its stat card', async () => {
    const response = await GET(new NextRequest(`https://os.nucleas.test/api/os/companies/${companyId}`), { params: Promise.resolve({ id: companyId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stats: { aiCitations: 17 } });
    expect(mocks.citations).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ role: 'assistant' }) }),
      { $count: 'count' },
    ]));
  });
});
