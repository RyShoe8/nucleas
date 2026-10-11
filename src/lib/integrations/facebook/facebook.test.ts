import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFacebookAuthUrl, createFacebookState, facebookRedirectUri, facebookSignInConfigured, verifyFacebookState } from './facebookOAuth';
import { exchangeFacebookPages, pickFacebookPage } from './facebookPages';

describe('facebook sign-in', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-for-state');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('signs state to one user and company and rejects tampering or other purposes', async () => {
    const state = await createFacebookState('user1', 'company1');
    expect(await verifyFacebookState(state)).toMatchObject({ userId: 'user1', companyId: 'company1' });
    expect(await verifyFacebookState(`${state}x`)).toBeNull();
    expect(await verifyFacebookState('')).toBeNull();
  });

  it('only redirects back to allowed hosts', () => {
    expect(facebookRedirectUri('https://os.nucleas.app/api/os/integrations/facebook/start')).toBe('https://os.nucleas.app/api/os/integrations/facebook/callback');
    expect(facebookRedirectUri('https://evil.example.com/x')).toBeNull();
  });

  it('builds the login url with the Page scopes and no secret', () => {
    const url = new URL(buildFacebookAuthUrl({ appId: '123', redirectUri: 'https://os.nucleas.app/cb', state: 's' }));
    expect(url.searchParams.get('client_id')).toBe('123');
    expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_read_engagement');
    expect(url.toString()).not.toMatch(/secret/i);
  });

  it('reports whether the app is configured', () => {
    expect(facebookSignInConfigured()).toBe(false);
    vi.stubEnv('FACEBOOK_APP_ID', '123');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'shh');
    expect(facebookSignInConfigured()).toBe(true);
  });
});

describe('exchangeFacebookPages', () => {
  const input = { code: 'the-code', redirectUri: 'https://os.nucleas.app/cb', appId: '123', appSecret: 'app-secret-value' };

  it('exchanges the code, upgrades to a long-lived token, and lists Pages without secrets in URLs', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/me/accounts')) return Response.json({ data: [{ id: 'p1', name: 'Frugal Gambler', access_token: 'page-token' }, { id: 'p2', name: 'No token' }] });
      const body = String(init?.body);
      return Response.json({ access_token: body.includes('fb_exchange_token') ? 'long-token' : 'short-token' });
    });
    const out = await exchangeFacebookPages(input, fetcher);
    expect(out).toEqual({ ok: true, pages: [{ id: 'p1', name: 'Frugal Gambler', token: 'page-token' }] });
    for (const call of calls) {
      expect(call.url).not.toContain('app-secret-value');
      expect(call.url).not.toMatch(/short-token|long-token/);
    }
    expect(String(calls[1].init?.body)).toContain('fb_exchange_token=short-token');
    expect((calls[2].init?.headers as Record<string, string>).authorization).toBe('Bearer long-token');
  });

  it('fails clearly when Facebook rejects the code or shares no Pages', async () => {
    expect(await exchangeFacebookPages(input, vi.fn(async () => new Response('{}', { status: 400 })))).toMatchObject({ ok: false });
    const none = vi.fn(async (url: string) => (url.includes('/me/accounts') ? Response.json({ data: [] }) : Response.json({ access_token: 't' })));
    expect(await exchangeFacebookPages(input, none)).toMatchObject({ ok: false, error: expect.stringContaining('No Facebook Pages') });
  });
});

describe('pickFacebookPage', () => {
  const page = (name: string) => ({ id: name, name, token: `t-${name}` });

  it('takes a sole Page that no other company uses', () => {
    expect(pickFacebookPage([page('Anything')], 'Frugal Gambler')).toMatchObject({ ok: true, page: { name: 'Anything' } });
  });

  it('matches the company by name among several', () => {
    expect(pickFacebookPage([page('Other'), page('The Frugal Gambler'), page('Third')], 'Frugal Gambler')).toMatchObject({ ok: true, page: { name: 'The Frugal Gambler' } });
  });

  it('does not reuse a Page that another company already connected', () => {
    const out = pickFacebookPage([page('PlayBound')], 'Frugal Gambler', ['PlayBound']);
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('already connected to another company') });
    expect(out.ok === false && out.error).toContain('Business integrations');
  });

  it('skips a claimed Page and takes the unclaimed one', () => {
    expect(pickFacebookPage([page('PlayBound'), page('Frugal Gambler Club')], 'Frugal Gambler', ['PlayBound'])).toMatchObject({ ok: true, page: { name: 'Frugal Gambler Club' } });
  });

  it('still lets a company reconnect its own Page', () => {
    expect(pickFacebookPage([page('PlayBound')], 'PlayBound', ['PlayBound'])).toMatchObject({ ok: true, page: { name: 'PlayBound' } });
  });

  it('asks the person to choose one Page when it cannot tell', () => {
    const out = pickFacebookPage([page('A'), page('B')], 'Frugal Gambler');
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('choose only') });
  });
});
