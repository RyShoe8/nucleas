import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { normalizeBaseUrl, pageInRequest } from './adminAccount';

describe('pageInRequest', () => {
  const base = 'https://playbound.club';
  it('finds the page a request names on the account’s site, however it is written', () => {
    expect(pageInRequest('On playbound.club/admin/connect/game-servers, OpenHV is listed twice.', base)).toBe('https://playbound.club/admin/connect/game-servers');
    expect(pageInRequest('See https://www.playbound.club/admin/games?tab=x. Fix it', base)).toBe('https://playbound.club/admin/games?tab=x');
    expect(pageInRequest('the playbound.club homepage', base)).toBe('https://playbound.club/');
  });
  it('ignores other sites', () => {
    expect(pageInRequest('On example.com/admin the list is wrong', base)).toBeNull();
    expect(pageInRequest('notplaybound.club/admin', base)).toBe('https://playbound.club/admin');
  });
});

describe('normalizeBaseUrl', () => {
  it('keeps only the https origin and refuses credentials or private hosts', () => {
    expect(normalizeBaseUrl('playbound.club/admin')).toBe('https://playbound.club');
    expect(() => normalizeBaseUrl('https://user:pw@playbound.club')).toThrow();
    expect(() => normalizeBaseUrl('http://localhost:3000')).toThrow();
  });
});
