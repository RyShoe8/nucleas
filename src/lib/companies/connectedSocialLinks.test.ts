import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ find: vi.fn(), updateOne: vi.fn(), credential: vi.fn() }));
vi.mock('@/lib/models/Integration', () => ({ IntegrationConnection: { find: () => ({ select: () => ({ lean: mocks.find }) }), updateOne: mocks.updateOne } }));
vi.mock('@/lib/integrations/connections', () => ({ readConnectionCredential: mocks.credential }));

import { blueskyProfileUrl, connectedSocialLinks, facebookPageLink, mergeSocialLinks } from './connectedSocialLinks';

const org = new Types.ObjectId();
const company = String(new Types.ObjectId());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  mocks.find.mockReset();
  mocks.updateOne.mockReset();
  mocks.credential.mockReset();
});

describe('connected social links', () => {
  it('builds a Bluesky profile link from the connected handle', () => {
    expect(blueskyProfileUrl('@playbound.bsky.social')).toBe('https://bsky.app/profile/playbound.bsky.social');
    expect(blueskyProfileUrl('not a handle!')).toBeNull();
    expect(blueskyProfileUrl(undefined)).toBeNull();
  });

  it('keeps listed links and only fills networks that have none', () => {
    expect(mergeSocialLinks([{ network: 'reddit', url: 'https://reddit.com/r/x' }, { network: 'bluesky', url: 'https://bsky.app/profile/typed' }], [{ network: 'bluesky', url: 'https://bsky.app/profile/connected' }, { network: 'facebook', url: 'https://www.facebook.com/p' }])).toEqual([
      { network: 'reddit', url: 'https://reddit.com/r/x' },
      { network: 'bluesky', url: 'https://bsky.app/profile/typed' },
      { network: 'facebook', url: 'https://www.facebook.com/p' },
    ]);
  });

  it('finds Bluesky from the handle, uses a stored Facebook link, and looks up then remembers a missing one', async () => {
    const fbWithUrl = { _id: new Types.ObjectId(), provider: 'facebook', accountUrl: 'https://www.facebook.com/stored' };
    mocks.find.mockResolvedValueOnce([{ _id: new Types.ObjectId(), provider: 'bluesky', accountLabel: '@playbound.bsky.social' }, fbWithUrl]);
    expect(await connectedSocialLinks(org, company)).toEqual([{ network: 'bluesky', url: 'https://bsky.app/profile/playbound.bsky.social' }, { network: 'facebook', url: 'https://www.facebook.com/stored' }]);

    const fb = { _id: new Types.ObjectId(), provider: 'facebook' };
    mocks.find.mockResolvedValueOnce([fb]);
    mocks.credential.mockResolvedValue('page-token');
    const f = vi.fn(async () => json({ link: 'https://www.facebook.com/PlayBoundClub/' }));
    expect(await connectedSocialLinks(org, company, f as never)).toEqual([{ network: 'facebook', url: 'https://www.facebook.com/PlayBoundClub/' }]);
    expect(mocks.updateOne).toHaveBeenCalledWith({ _id: fb._id }, { $set: { accountUrl: 'https://www.facebook.com/PlayBoundClub/' } });
    expect((f.mock.calls[0] as unknown[])[0]).not.toContain('page-token');
  });

  it('shows no Facebook button when the Page cannot be read, and rejects non-Facebook links', async () => {
    mocks.find.mockResolvedValueOnce([{ _id: new Types.ObjectId(), provider: 'facebook' }]);
    mocks.credential.mockResolvedValue('t');
    expect(await connectedSocialLinks(org, company, (async () => json({}, 400)) as never)).toEqual([]);
    expect(await facebookPageLink('t', (async () => json({ link: 'https://evil.example/x' })) as never)).toBeNull();
  });
});
