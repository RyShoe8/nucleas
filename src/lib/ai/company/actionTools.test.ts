import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ propose: vi.fn(), createJob: vi.fn() }));
vi.mock('@/lib/building/builds', () => ({ proposeCodeChange: (...a: unknown[]) => mocks.propose(...a) }));
vi.mock('@/lib/jobs/jobs', () => ({ createJob: (...a: unknown[]) => mocks.createJob(...a) }));
vi.mock('@/lib/building/companyCode', () => ({ companiesWithRepositories: async () => new Map([['pb', 'RyShoe8/playbound']]) }));
vi.mock('./companyTools', () => ({
  matchCompany: (companies: { name: string }[], ref: unknown) => companies.find((c) => c.name.toLowerCase() === String(ref).toLowerCase()) ?? null,
}));

import { withActionTools } from './actionTools';

const viewer = { userId: 'u'.repeat(24), organizationId: new Types.ObjectId(), employeeId: null, role: 'Administrator' as const };
const companies = [
  { id: 'pb', name: 'Playbound.club' },
  { id: 'fg', name: 'Frugal Gambler' },
] as never;
const base = { definitions: [{ type: 'function' as const, function: { name: 'company_metrics', description: 'm', parameters: { type: 'object', properties: {}, required: [] } } }], execute: vi.fn(async () => '{"ok":true,"from":"base"}') };
const ctx = { runId: new Types.ObjectId() };

beforeEach(() => vi.clearAllMocks());

describe('action tools for any Ask model', () => {
  it('offers code changes only for companies with a repository, and jobs for all', async () => {
    const { toolSet } = await withActionTools(base, { viewer, companies, level: 'low' });
    const names = toolSet.definitions.map((d) => d.function.name);
    expect(names).toEqual(['company_metrics', 'plan_code_change', 'design_job']);
    const plan = toolSet.definitions[1].function.parameters as { properties: { company: { enum: string[] } } };
    expect(plan.properties.company.enum).toEqual(['Playbound.club']);
    expect(await toolSet.execute('company_metrics', '{}', ctx)).toBe('{"ok":true,"from":"base"}');
  });

  it('plans the code change through Building and keeps the card for the reply', async () => {
    mocks.propose.mockResolvedValue({ ok: true, costMicros: 0, build: { id: 'b1', title: 'Remove OpenHV under OpenRA', summary: 'Drop the duplicate listing.' } });
    const { toolSet, results } = await withActionTools(base, { viewer, companies, level: 'medium' });
    const out = JSON.parse(await toolSet.execute('plan_code_change', JSON.stringify({ company: 'Playbound.club', request: 'On /admin/connect/game-servers remove the OpenHV listing under OpenRA' }), ctx));
    expect(out).toMatchObject({ ok: true, planned: 'Remove OpenHV under OpenRA' });
    expect(mocks.propose).toHaveBeenCalledWith(viewer, expect.objectContaining({ companyId: 'pb', level: 'medium' }));
    expect(results.build).toMatchObject({ id: 'b1' });
    // One per reply.
    expect(JSON.parse(await toolSet.execute('plan_code_change', JSON.stringify({ company: 'Playbound.club', request: 'another change to make here' }), ctx)).ok).toBe(false);
    expect(JSON.parse(await toolSet.execute('plan_code_change', JSON.stringify({ company: 'Frugal Gambler', request: 'change something on the site' }), ctx)).error).toMatch(/already planned|no repository/);
  });

  it('designs jobs through the job designer and relays its questions', async () => {
    mocks.createJob.mockResolvedValue({ ok: true, job: { id: 'j1', status: 'needs_answers', design: { title: 'Daily backlink', questions: [{ question: 'Which address sends outreach?' }] } } });
    const { toolSet, results } = await withActionTools(base, { viewer, companies, level: 'low' });
    const out = JSON.parse(await toolSet.execute('design_job', JSON.stringify({ company: 'Frugal Gambler', request: 'Every day earn one dofollow backlink' }), ctx));
    expect(out).toMatchObject({ ok: true, status: 'needs_answers', questions: ['Which address sends outreach?'] });
    expect(results.job).toMatchObject({ id: 'j1' });
    expect(JSON.parse(await toolSet.execute('design_job', JSON.stringify({ company: 'Nobody', request: 'something to do daily' }), ctx)).error).toBe('Unknown company.');
  });
});
