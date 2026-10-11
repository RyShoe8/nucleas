import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveCompanyProfile } from './companyProfile';

const id = (n: string) => ({ toString: () => n }) as never;

describe('company subreddit in the profile', () => {
  it('adds the manually entered subreddit as a Reddit link', () => {
    const profile = resolveCompanyProfile({ _id: id('a'), name: 'Frugal', subreddit: 'TheFrugalGambler', socialLinks: [{ network: 'x', url: 'https://x.com/f' }] } as never, null);
    expect(profile.subreddit).toBe('TheFrugalGambler');
    expect(profile.socialLinks).toEqual([
      { network: 'x', url: 'https://x.com/f' },
      { network: 'reddit', url: 'https://www.reddit.com/r/TheFrugalGambler' },
    ]);
  });

  it('does not duplicate a Reddit link that already points at the subreddit', () => {
    const profile = resolveCompanyProfile({ _id: id('a'), name: 'Frugal', subreddit: 'thefrugalgambler', socialLinks: [{ network: 'reddit', url: 'https://reddit.com/r/TheFrugalGambler' }] } as never, null);
    expect(profile.socialLinks).toHaveLength(1);
  });

  it('leaves links alone when no subreddit is set', () => {
    expect(resolveCompanyProfile({ _id: id('a'), name: 'Frugal' } as never, null)).toMatchObject({ socialLinks: [], subreddit: undefined });
  });
});
