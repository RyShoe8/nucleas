import { describe, expect, it, vi } from 'vitest';
import { releaseSources, deployedSources, completeExcerpt } from './sources';
const api = vi.hoisted(() => ({ listReleases: vi.fn(), compareCommitsWithBasehead: vi.fn(), listDeployments: vi.fn(), listDeploymentStatuses: vi.fn(), listCommits: vi.fn() }));
vi.mock('@/lib/ai/githubAppClient', () => ({ createInstallationOctokit: vi.fn(() => ({ repos: api })) }));

describe('released GitHub source windows', () => {
  it('excludes drafts, prereleases and HEAD; sparse notes compare only the previous release tag', async () => {
    const release = (id: number, tag: string, published: string, extra = {}) => ({ id, tag_name: tag, name: tag, published_at: published, body: '', html_url: `https://github.com/org/game/releases/tag/${tag}`, draft: false, prerelease: false, ...extra });
    api.listReleases.mockResolvedValue({ data: [
      release(1, 'v1', '2026-10-01T00:00:00Z'),
      release(2, 'v2', '2026-10-03T00:00:00Z'),
      release(3, 'v3', '2026-10-04T00:00:00Z', { draft: true }),
      release(4, 'v4', '2026-10-05T00:00:00Z', { prerelease: true }),
      release(5, 'v5', '2026-10-10T00:00:00Z'),
    ] });
    api.compareCommitsWithBasehead.mockResolvedValue({ data: { commits: [{ commit: { message: 'Added controller support for racing games' } }, { commit: { message: 'chore: upgrade internal dependencies' } }] } });
    const sources = await releaseSources({ owner: 'org', repo: 'game', installationId: '42' }, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-10T00:00:00Z'));
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('github:org/game:2');
    expect(sources[0].description).not.toContain('dependencies');
    expect(api.compareCommitsWithBasehead).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ basehead: 'v1...v2' }));
  });
});

describe('confirmed production changelog sources', () => {
  const binding = { owner: 'org', repo: 'site', installationId: '42' };
  const start = new Date('2026-10-02T00:00:00Z'), end = new Date('2026-10-23T00:00:00Z');
  it('uses successful production bounds, excludes previews and failures, and groups public changes', async () => {
    api.listDeployments.mockResolvedValue({ data: [
      { id: 1, sha: 'preview', environment: 'Preview', created_at: '2026-10-22T00:00:00Z' },
      { id: 2, sha: 'failed', environment: 'Production', created_at: '2026-10-21T00:00:00Z' },
      { id: 3, sha: 'live', environment: 'production', created_at: '2026-10-20T00:00:00Z' },
      { id: 4, sha: 'before', environment: 'Production', created_at: '2026-10-01T00:00:00Z' },
    ] });
    api.listDeploymentStatuses.mockImplementation(async ({ deployment_id }) => ({ data: [{ state: deployment_id === 2 ? 'failure' : 'success', created_at: deployment_id === 4 ? '2026-10-01T00:00:00Z' : '2026-10-20T00:00:00Z' }] }));
    api.listCommits.mockResolvedValue({ data: ['Add friend invitations', 'Fix mobile game filters', 'Improve game discovery', 'chore: upgrade internal dependencies', 'Bump launcher release version', 'Record hosting isolation acceptance'].map(message => ({ commit: { message, committer: { date: '2026-10-19T00:00:00Z' } } })) });
    const result = await deployedSources(binding, start, end);
    expect(result.map(r => r.title)).toEqual(['Platform updates — added', 'Platform updates — improved', 'Platform updates — fixed']);
    expect(result.map(r => r.description).join('\n')).not.toContain('dependencies');
    expect(result.map(r => r.description).join('\n')).not.toContain('isolation');
    expect(api.listCommits).toHaveBeenLastCalledWith(expect.objectContaining({ sha: 'live', since: start.toISOString(), until: end.toISOString() }));
  });
  it('never includes commits outside the window or silently switches to HEAD', async () => {
    api.listDeployments.mockResolvedValue({ data: [{ id: 3, sha: 'live', environment: 'Production', created_at: '2026-10-20T00:00:00Z' }] });
    api.listDeploymentStatuses.mockResolvedValue({ data: [{ state: 'success', created_at: '2026-10-20T00:00:00Z' }] });
    api.listCommits.mockResolvedValue({ data: [{ commit: { message: 'Add old feature', committer: { date: '2026-10-01T00:00:00Z' } } }] });
    expect(await deployedSources(binding, start, end)).toEqual([]);
    expect(api.listCommits).toHaveBeenLastCalledWith(expect.objectContaining({ sha: 'live' }));
  });
  it('omits work with no successful production deployment', async () => {
    api.listDeployments.mockResolvedValue({ data: [] });
    expect(await deployedSources(binding, start, end)).toEqual([]);
  });
  it('keeps complete sentences and never cuts a word without an ellipsis', () => {
    expect(completeExcerpt('A complete first sentence. ' + 'Another sentence '.repeat(30), 100)).toBe('A complete first sentence. Another sentence Another sentence Another sentence Another sentence…');
    expect(completeExcerpt('A reasonably detailed first sentence about the game and how it plays. ' + 'More '.repeat(70), 100)).toBe('A reasonably detailed first sentence about the game and how it plays.');
  });
});
