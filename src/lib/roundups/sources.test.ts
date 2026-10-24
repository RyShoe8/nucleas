import { describe, expect, it, vi } from 'vitest';
import { releaseSources } from './sources';
const api = vi.hoisted(() => ({ listReleases: vi.fn(), compareCommitsWithBasehead: vi.fn() }));
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
