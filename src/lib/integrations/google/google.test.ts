import { beforeAll, describe, expect, it, vi } from 'vitest';
import { matchGa4Property, matchGscSite } from './connectGoogle';
import {
  buildGoogleIntegrationAuthUrl,
  createGoogleIntegrationState,
  googleIntegrationRedirectUri,
  verifyGoogleIntegrationState,
} from './googleOAuth';

beforeAll(() => {
  vi.stubEnv('NEXTAUTH_SECRET', 'state-test-secret');
});

describe('Google property matching', () => {
  const properties = [
    { id: '1', displayName: 'Frugal Gambler', hosts: ['frugalgambler.club'] },
    { id: '2', displayName: 'Tailnote', hosts: ['tailnote.io', 'app.tailnote.io'] },
    { id: '3', displayName: 'Dup A', hosts: ['dup.com'] },
    { id: '4', displayName: 'Dup B', hosts: ['dup.com'] },
  ];

  it('matches a GA4 property by stream host', () => {
    expect(matchGa4Property('frugalgambler.club', properties)?.id).toBe('1');
    expect(matchGa4Property('tailnote.io', properties)?.id).toBe('2');
    expect(matchGa4Property('playbound.club', properties)).toBeUndefined();
  });

  it('refuses to guess between ambiguous GA4 properties', () => {
    expect(matchGa4Property('dup.com', properties)).toBeUndefined();
  });

  it('prefers Search Console domain properties over URL prefixes', () => {
    const sites = [
      { siteUrl: 'https://frugalgambler.club/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:frugalgambler.club', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.playbound.club/', permissionLevel: 'siteFullUser' },
    ];
    expect(matchGscSite('frugalgambler.club', sites)?.siteUrl).toBe('sc-domain:frugalgambler.club');
    expect(matchGscSite('playbound.club', sites)?.siteUrl).toBe('https://www.playbound.club/');
    expect(matchGscSite('tailnote.io', sites)).toBeUndefined();
  });
});

describe('Google OAuth plumbing', () => {
  it('only issues callbacks for allowlisted hosts', () => {
    expect(googleIntegrationRedirectUri('https://os.nucleas.app/api/os/integrations/google/start')).toBe(
      'https://os.nucleas.app/api/os/integrations/google/callback'
    );
    expect(googleIntegrationRedirectUri('http://os.localhost:3000/x')).toBe('http://os.localhost:3000/api/os/integrations/google/callback');
    expect(googleIntegrationRedirectUri('https://evil.example/x')).toBeNull();
  });

  it('round-trips signed state and rejects tampering', async () => {
    const token = await createGoogleIntegrationState('user-1', 'company-1');
    expect(await verifyGoogleIntegrationState(token)).toMatchObject({ userId: 'user-1', companyId: 'company-1' });
    expect(await verifyGoogleIntegrationState(`${token}x`)).toBeNull();
  });

  it('requests read-only scopes with offline access', () => {
    const url = new URL(buildGoogleIntegrationAuthUrl({ clientId: 'cid', redirectUri: 'https://os.nucleas.app/cb', state: 's' }));
    expect(url.searchParams.get('scope')).toContain('analytics.readonly');
    expect(url.searchParams.get('scope')).toContain('webmasters.readonly');
    expect(url.searchParams.get('scope')).not.toMatch(/analytics(?!\.readonly)|webmasters(?!\.readonly)/);
    expect(url.searchParams.get('access_type')).toBe('offline');
  });
});
