import { describe, expect, it, vi } from 'vitest';
import { PublishError, blueskyFacets, facebookTokenCanPost, publishToBluesky, publishToFacebook, splitBlueskyCredential } from './publishers';
import { blueskyPostRef, redditExampleText, redditJsonUrl } from './examples';
import { platformsNamed, recognizeRequest, wantsMailbox } from './setup';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Bluesky', () => {
  it('marks links and hashtags with UTF-8 byte offsets', () => {
    const text = 'Co-op 🎮 is back https://playbound.club/g #Gaming #42';
    const facets = blueskyFacets(text);
    expect(facets).toHaveLength(2);
    const bytes = new TextEncoder().encode(text);
    const slice = (f: (typeof facets)[number]) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    expect(slice(facets[0]!)).toBe('https://playbound.club/g');
    expect(slice(facets[1]!)).toBe('#Gaming');
  });

  it('needs handle:app-password', () => {
    expect(splitBlueskyCredential('@pb.bsky.social:abcd-efgh-ijkl-mnop')).toEqual({ identifier: 'pb.bsky.social', password: 'abcd-efgh-ijkl-mnop' });
    expect(() => splitBlueskyCredential('nopassword')).toThrow(PublishError);
  });

  it('posts with a link card and returns the post address', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url.endsWith('createSession')) return json(200, { accessJwt: 't', did: 'did:plc:1', handle: 'pb.bsky.social', didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] } });
      if (url === 'https://playbound.club/cover.jpg') return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      if (url.endsWith('uploadBlob')) return json(200, { blob: { ref: 'b' } });
      if (url.endsWith('createRecord')) return json(200, { uri: 'at://did:plc:1/app.bsky.feed.post/3abc' });
      return json(404, {});
    });
    const out = await publishToBluesky('pb.bsky.social:abcd-efgh-ijkl-mnop', { text: 'New game!', link: 'https://playbound.club/games/x', linkTitle: 'X', imageUrl: 'https://playbound.club/cover.jpg' }, fetcher);
    expect(out.url).toBe('https://bsky.app/profile/pb.bsky.social/post/3abc');
    const record = calls.find((c) => c.url === 'https://pds.example/xrpc/com.atproto.repo.createRecord')!.body as { record: { embed: { external: { uri: string; thumb: unknown } } } };
    expect(record.record.embed.external).toMatchObject({ uri: 'https://playbound.club/games/x', thumb: { ref: 'b' } });
  });

  it('reports a rejected app password as needing reconnection', async () => {
    const fetcher = async () => json(401, { error: 'AuthenticationRequired' });
    await expect(publishToBluesky('pb:abcd-efgh-ijkl-mnop', { text: 'x', link: null }, fetcher)).rejects.toMatchObject({ code: 'needs_reauth' });
  });
});

describe('Facebook', () => {
  it('posts to the Page feed with the link', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain('link=https%3A%2F%2Fplaybound.club%2Fg');
      return json(200, { id: '123_456' });
    });
    expect(await publishToFacebook('tok', { text: 'Hi', link: 'https://playbound.club/g' }, fetcher)).toEqual({ url: 'https://www.facebook.com/123_456' });
  });

  it('tells a missing permission from an expired token from a busy server', async () => {
    await expect(publishToFacebook('t', { text: 'x', link: null }, async () => json(403, { error: { code: 200, message: 'Requires pages_manage_posts' } }))).rejects.toMatchObject({ code: 'needs_permission' });
    await expect(publishToFacebook('t', { text: 'x', link: null }, async () => json(400, { error: { code: 190 } }))).rejects.toMatchObject({ code: 'needs_reauth' });
    await expect(publishToFacebook('t', { text: 'x', link: null }, async () => json(500, { error: { code: 2 } }))).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('reads whether a token may post from debug_token', async () => {
    process.env.FACEBOOK_APP_ID = 'app';
    process.env.FACEBOOK_APP_SECRET = 'secret';
    expect(await facebookTokenCanPost('t', async () => json(200, { data: { is_valid: true, scopes: ['pages_show_list', 'pages_manage_posts'] } }))).toBe(true);
    expect(await facebookTokenCanPost('t', async () => json(200, { data: { is_valid: true, scopes: ['pages_show_list'] } }))).toBe(false);
    expect(await facebookTokenCanPost('t', async () => json(500, {}))).toBeNull();
    delete process.env.FACEBOOK_APP_ID;
    expect(await facebookTokenCanPost('t', async () => json(200, {}))).toBeNull();
  });
});

describe('example posts', () => {
  it('recognizes Bluesky and Reddit post links', () => {
    expect(blueskyPostRef('https://bsky.app/profile/playbound.bsky.social/post/3mxzclf2a4c2o')).toEqual({ handle: 'playbound.bsky.social', rkey: '3mxzclf2a4c2o' });
    expect(redditJsonUrl('https://www.reddit.com/r/PlayBoundGaming/comments/1x7phkv/new_game_release_deus_ex_online_coop/')).toBe('https://www.reddit.com/r/PlayBoundGaming/comments/1x7phkv/new_game_release_deus_ex_online_coop.json?raw_json=1');
    expect(redditJsonUrl('https://www.reddit.com/r/PlayBoundGaming/')).toBeNull();
  });

  it('turns a Reddit listing into title, body and link', () => {
    const listing = [{ data: { children: [{ data: { title: 'New Game Release: Deus Ex', selftext: 'Co-op is live.', url: 'https://playbound.club/games/deus-ex' } }] } }];
    expect(redditExampleText(listing)).toBe('Title: New Game Release: Deus Ex\n\nCo-op is live.\n\nLink: https://playbound.club/games/deus-ex');
  });
});

describe('recognizing a request', () => {
  it('knows publishing, link building and marketing plans, and leaves the rest to the designer', () => {
    expect(recognizeRequest('When a new game is published, post it to Facebook, Bluesky and Reddit')).toBe('social_publish');
    expect(recognizeRequest('Share every new article on our socials')).toBe('social_publish');
    expect(recognizeRequest('Every day, earn one dofollow backlink')).toBe('link_building');
    expect(recognizeRequest('Build a marketing plan for PlayBound')).toBe('marketing_plan');
    expect(recognizeRequest('Research Deadlock and add it to the catalog')).toBe('custom');
  });

  it('reads named platforms and inbox requests', () => {
    expect(platformsNamed('post to bsky and reddit')).toEqual(['bluesky', 'reddit']);
    expect(platformsNamed('post to our socials')).toEqual([]);
    expect(wantsMailbox('Post the best casino deals from our email to Bluesky')).toBe(true);
    expect(wantsMailbox('Post new games')).toBe(false);
  });
});
