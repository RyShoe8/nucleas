import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { ReleaseRoundup, ReleaseRoundupSettings } from '@/lib/models/ReleaseRoundup';
import Project from '@/lib/models/Project';
import { AiProjectRepository } from '@/lib/models/AiProjectRepository';
import { mutateRoundup, publishRoundup, generateRoundup, copySchema } from './service';
import { askEngine } from '@/lib/ai/engine/ask';
import { siteRequest, endpointFor, signature, playerNotes, secretFor } from './sources';
import type { CompanyViewer } from '@/lib/companies/companyProfile';

vi.mock('@/lib/companies/companyProfile', () => ({ getCompanyProfile: vi.fn(async () => ({ name: 'PlayBound', domain: 'playbound.club' })), isCompanyManager: (v: CompanyViewer) => v.role === 'Manager' }));
vi.mock('@/lib/brandVoice/service', () => ({ brandVoiceContext: vi.fn(async () => 'Approved voice') }));
vi.mock('@/lib/ai/engine/ask', () => ({ askEngine: vi.fn() }));
vi.mock('./sources', async importOriginal => ({ ...await importOriginal<typeof import('./sources')>(), siteRequest: vi.fn(), releaseSources: vi.fn(async () => []) }));

const companyId = new Types.ObjectId().toString();
const viewer: CompanyViewer = { userId: new Types.ObjectId().toString(), organizationId: new Types.ObjectId(), employeeId: null, role: 'Manager' };
const gameId = new Types.ObjectId().toString();
function draft(status = 'draft') {
  return new ReleaseRoundup({ companyId, organizationId: viewer.organizationId, createdByUserId: viewer.userId, status, active: true, idempotencyKey: 'ae111609-c767-4b1a-949a-479dcb7d794f', title: 'New games', summary: 'A game is available.', bodyMarkdown: 'Try the new game.', coveredIds: [gameId, 'github:org/repo:42'], coverageStart: new Date('2026-10-02T00:00:00Z'), coverageEnd: new Date('2026-10-20T00:00:00Z'), createdAt: new Date(), updatedAt: new Date() });
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(siteRequest).mockReset();
  process.env[`NUCLEAS_ROUNDUP_SECRET_${companyId.toUpperCase()}`] = 'test-secret';
  vi.spyOn(Project, 'find').mockReturnValue({ select: () => ({ lean: async () => [] }) } as never);
  vi.spyOn(AiProjectRepository, 'find').mockResolvedValue([]);
  vi.spyOn(ReleaseRoundupSettings, 'findOne').mockResolvedValue(null);
});

describe('manual roundup safety with mocked persistence and sources', () => {
  it('duplicate generate and reopen return the same active draft without creation', async () => {
    const row = draft();
    vi.spyOn(ReleaseRoundup, 'init').mockResolvedValue(ReleaseRoundup as never);
    vi.spyOn(ReleaseRoundup, 'findOne').mockResolvedValue(row);
    const create = vi.spyOn(ReleaseRoundup, 'create');
    const first = await mutateRoundup(viewer, { action: 'generate', companyId });
    const second = await mutateRoundup(viewer, { action: 'reopen', companyId });
    expect(first.draft?.id).toBe(second.draft?.id);
    expect(create).not.toHaveBeenCalled();
    expect(siteRequest).not.toHaveBeenCalled();
  });
  it('reject only closes the active draft and never advances published coverage', async () => {
    const row = draft('rejected'); row.active = false;
    const update = vi.spyOn(ReleaseRoundup, 'findOneAndUpdate').mockResolvedValue(row);
    await mutateRoundup(viewer, { action: 'reject', companyId, id: String(row._id) });
    expect(update.mock.calls[0][0]).toMatchObject({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(companyId), status: { $in: ['draft', 'failed', 'queued'] } });
    expect(update.mock.calls[0][1]).toEqual({ $set: { active: false, status: 'rejected', progress: 'Rejected; coverage unchanged' } });
    expect(siteRequest).not.toHaveBeenCalled();
  });
  it('uncertain publication retains key and retries identical payload, then confirms original coverageEnd', async () => {
    const row = draft();
    vi.spyOn(ReleaseRoundup, 'findOne').mockResolvedValue(row);
    const update = vi.spyOn(ReleaseRoundup, 'findOneAndUpdate').mockImplementation((async (_filter: unknown, changes: unknown) => {
      const value = changes as { $set?: Record<string, unknown> };
      Object.assign(row, value.$set);
      return row;
    }) as never);
    vi.mocked(siteRequest).mockRejectedValueOnce(new Error('Timeout after remote insert'));
    expect((await publishRoundup(viewer, companyId, String(row._id))).status).toBe('publish_uncertain');
    expect(row.active).toBe(true);
    expect(update.mock.calls.some(call => (call[1] as { $set?: { status?: string } }).$set?.status === 'published')).toBe(false);
    vi.mocked(siteRequest).mockResolvedValueOnce({ created: false, post: { sourceKey: `nucleas:roundup:${row.idempotencyKey}`, publishedAt: '2026-10-23T00:00:00Z', url: 'https://playbound.club/blog/roundup', title: row.title, summary: row.summary, bodyMarkdown: row.bodyMarkdown, coverageStart: row.coverageStart!.toISOString(), coverageEnd: row.coverageEnd!.toISOString(), coveredIds: [gameId] } });
    const confirmed = await publishRoundup(viewer, companyId, String(row._id));
    expect(confirmed.status).toBe('published');
    expect(confirmed.coverageEnd).toBe('2026-10-20T00:00:00.000Z');
    expect(siteRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(siteRequest).mock.calls[0][3]).toEqual(vi.mocked(siteRequest).mock.calls[1][3]);
    expect((vi.mocked(siteRequest).mock.calls[0][3] as { coveredIds: string[] }).coveredIds).toEqual([gameId]);
  });
  it('refuses member publish and reject', async () => {
    const member = { ...viewer, role: 'User' as const };
    await expect(publishRoundup(member, companyId, new Types.ObjectId().toString())).rejects.toMatchObject({ status: 403 });
    await expect(mutateRoundup(member, { companyId, action: 'reject', id: new Types.ObjectId().toString() })).rejects.toMatchObject({ status: 403 });
  });
  it('schema declares a unique partial active-company index', () => {
    expect(ReleaseRoundup.schema.indexes()).toContainEqual(expect.arrayContaining([expect.objectContaining({ organizationId: 1, companyId: 1 }), expect.objectContaining({ unique: true, partialFilterExpression: { active: true } })]));
  });
  it('enforces site copy limits and sanitizes HTML', () => {
    expect(copySchema.safeParse({ title: 'a'.repeat(161), summary: 's', bodyMarkdown: 'b' }).success).toBe(false);
    expect(copySchema.safeParse({ title: 't', summary: 'a'.repeat(401), bodyMarkdown: 'b' }).success).toBe(false);
    expect(copySchema.parse({ title: '<b>Title</b>', summary: 'summary', bodyMarkdown: 'body<script>alert(1)</script>' }).bodyMarkdown).toBe('body');
  });
  it('uses only a production domain and scopes the shared secret to PlayBound', () => {
    process.env.NUCLEAS_ROUNDUP_SECRET = 'pb-test';
    expect(endpointFor('http://localhost')).toBeNull();
    expect(endpointFor('https://127.0.0.1')).toBeNull();
    expect(endpointFor('https://public.com/evil')).toBeNull();
    expect(secretFor('other-company', endpointFor('playbound.club'))).toBe('pb-test');
    expect(secretFor('other-company', endpointFor('other.com'))).toBeUndefined();
    expect(signature('secret', '1', 'GET', 'https://playbound.club/api?since=a&until=b', '')).not.toBe(signature('secret', '1', 'GET', 'https://playbound.club/api?until=b&since=a', ''));
  });
  it('rejects internal-only or empty release notes as player updates', () => {
    expect(playerNotes('## What\'s new\nchore: update dependencies\nci: faster tests')).toBe('');
    expect(playerNotes('Added controller support for racing games')).toContain('controller support');
  });
  it('generates once for free, preserves source warnings, excludes covered IDs, and signs window query', async () => {
    const row = draft('queued');
    vi.spyOn(AiProjectRepository, 'find').mockResolvedValue([{ _id: new Types.ObjectId(), owner: 'org', repo: 'game', installationId: '1' }] as never);
    vi.spyOn(ReleaseRoundup, 'findOneAndUpdate').mockResolvedValue(row);
    vi.spyOn(ReleaseRoundup, 'findOne').mockReturnValue({ sort: async () => null } as never);
    vi.spyOn(ReleaseRoundup, 'find').mockReturnValue({ select: () => ({ lean: async () => [{ coveredIds: [gameId] }] }) } as never);
    const updates = vi.spyOn(ReleaseRoundup, 'updateOne').mockResolvedValue({} as never);
    const newId = new Types.ObjectId().toString();
    const site = { baseline: { publishedAt: '2026-10-02T00:00:00Z', coverageEnd: '2026-10-01T00:00:00Z', slug: 'manual', coveredIds: [] }, games: [gameId, newId].map(id => ({ id, slug: id, title: 'Racing', url: `https://playbound.club/games/${id}`, publishedAt: '2026-10-02T12:00:00Z', description: 'Race your friends', platforms: ['browser'], priceType: 'FREE' })), limitations: ['Publication is latest publication, not first publication.'] };
    vi.mocked(siteRequest).mockResolvedValue(site);
    vi.mocked(askEngine).mockResolvedValue(null);
    await generateRoundup(viewer, companyId, String(row._id));
    expect(askEngine).toHaveBeenCalledTimes(1);
    expect(vi.mocked(askEngine).mock.calls[0][0]).toMatchObject({ level: 'free', need: 'write' });
    expect(vi.mocked(siteRequest).mock.calls[1][0]).toContain('since=2026-10-01');
    const sets = (updates.mock.calls as unknown as unknown[][]).map(c => (c[1] as { $set?: Record<string, unknown> }).$set);
    const ready = sets.find(s => s?.status === 'draft');
    expect(ready?.coveredIds).toEqual([newId]);
    expect(ready?.bodyMarkdown).toContain(`](https://playbound.club/games/${newId})`);
    expect(sets.some(s => (s?.warnings as string[] | undefined)?.includes(site.limitations[0]))).toBe(true);
  });
});
