import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({ findOne: vi.fn(), credential: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/models/Integration', () => ({
  IntegrationConnection: { findOne: (...args: unknown[]) => ({ select: () => ({ lean: () => mocks.findOne(...args) }) }) },
}));
vi.mock('@/lib/integrations/connections', () => ({ readConnectionCredential: (...args: unknown[]) => mocks.credential(...args) }));

import { blueskyHandleFromUrl, collectSocialVoiceSamples } from './voiceSamples';

const org = new Types.ObjectId();
const company = String(new Types.ObjectId());

function fetcher(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const hit = Object.entries(routes).find(([key]) => url.includes(key));
    return hit ? Response.json(hit[1]) : new Response('{}', { status: 404 });
  });
}

describe('social voice samples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOne.mockImplementation(async () => null);
  });

  it('reads handles from bsky.app profile links only', () => {
    expect(blueskyHandleFromUrl('https://bsky.app/profile/playbound.bsky.social')).toBe('playbound.bsky.social');
    expect(blueskyHandleFromUrl('https://evil.example/profile/x.bsky.social')).toBeNull();
  });

  it('collects the account’s own Bluesky posts and leaves out reposts and other authors', async () => {
    const feed = {
      feed: [
        { post: { author: { handle: 'playbound.bsky.social' }, record: { text: 'Fun today.   1-Click installs!' } } },
        { post: { author: { handle: 'playbound.bsky.social' }, record: { text: 'Reposted thing' } }, reason: { $type: 'repost' } },
        { post: { author: { handle: 'someone.else' }, record: { text: 'Not ours' } } },
      ],
    };
    const out = await collectSocialVoiceSamples(
      { organizationId: org, companyId: company, socialLinks: [{ network: 'bluesky', url: 'https://bsky.app/profile/playbound.bsky.social' }] },
      fetcher({ getAuthorFeed: feed })
    );
    expect(out.block).toContain('Fun today. 1-Click installs!');
    expect(out.block).not.toContain('Reposted thing');
    expect(out.block).not.toContain('Not ours');
    expect(out.sources).toEqual(['https://bsky.app/profile/playbound.bsky.social']);
    expect(out.gaps).toEqual([]);
  });

  it('uses the connected Bluesky account’s handle when no profile link is listed', async () => {
    mocks.findOne.mockImplementation(async (filter: { provider: string }) => (filter.provider === 'bluesky' ? { accountLabel: '@playbound.bsky.social' } : null));
    const feed = { feed: [{ post: { author: { handle: 'playbound.bsky.social' }, record: { text: 'Hello from the connected account' } } }] };
    const out = await collectSocialVoiceSamples({ organizationId: org, companyId: company, socialLinks: [] }, fetcher({ getAuthorFeed: feed }));
    expect(out.block).toContain('Hello from the connected account');
    expect(out.sources).toEqual(['https://bsky.app/profile/playbound.bsky.social']);
  });

  it('reads Facebook posts through the connected Page token without putting it in the URL', async () => {
    mocks.findOne.mockImplementation(async (filter: { provider: string }) => (filter.provider === 'facebook' ? { _id: new Types.ObjectId(), accountLabel: 'PlayBound' } : null));
    mocks.credential.mockResolvedValue('page-token-123');
    const f = fetcher({ '/me/posts': { data: [{ message: 'New co-op night Friday' }, {}] } });
    const out = await collectSocialVoiceSamples({ organizationId: org, companyId: company, socialLinks: [{ network: 'facebook', url: 'https://facebook.com/playbound' }] }, f);
    expect(out.block).toContain('New co-op night Friday');
    expect(out.sources).toEqual(['https://facebook.com/playbound']);
    expect(f.mock.calls[0][0]).not.toContain('page-token-123');
  });

  it('reports channels it cannot read instead of ignoring them', async () => {
    const out = await collectSocialVoiceSamples(
      { organizationId: org, companyId: company, subreddit: 'PlayBound', socialLinks: [{ network: 'facebook', url: 'https://facebook.com/playbound' }, { network: 'bluesky', url: 'https://bsky.app/profile/x.bsky.social' }] },
      fetcher({})
    );
    expect(out.block).toBe('');
    expect(out.gaps.join(' ')).toMatch(/Facebook: connect the Page/);
    expect(out.gaps.join(' ')).toMatch(/Bluesky posts could not be read/);
    expect(out.gaps.join(' ')).toMatch(/Reddit r\/PlayBound: Reddit cannot be read automatically/);
  });
});
