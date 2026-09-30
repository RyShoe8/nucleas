import { describe, expect, it } from 'vitest';
import { sanitizeSessionCookies } from './sessionCookies';

const state = {
  cookies: [
    { name: 'session', value: 'abc', domain: 'playbound.club', path: '/', expires: 4102444800, httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'csrf', value: 'x', domain: '.playbound.club', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Strict' },
    { name: 'ga', value: '1', domain: '.google.com', path: '/', expires: 4102444800 },
    { name: 'evil', value: '1', domain: 'notplaybound.club', path: '/' },
  ],
  origins: [],
};

describe('sanitizeSessionCookies', () => {
  it('keeps only the site’s own cookies from a storageState and reports the earliest expiry', () => {
    const { cookies, expiresAt } = sanitizeSessionCookies(state, 'https://playbound.club');
    expect(cookies.map((c) => c.name)).toEqual(['session', 'csrf']);
    expect(expiresAt?.getUTCFullYear()).toBe(2100);
  });

  it('accepts a plain cookie list in the browser-extension format', () => {
    const { cookies } = sanitizeSessionCookies([{ name: 'sid', value: 'v', domain: 'www.example.com', expirationDate: 4102444800, sameSite: 'no_restriction' }], 'https://www.example.com');
    expect(cookies[0]).toMatchObject({ name: 'sid', sameSite: 'None', expires: 4102444800 });
  });

  it('refuses an export with nothing for the site', () => {
    expect(() => sanitizeSessionCookies({ cookies: [{ name: 'a', value: 'b', domain: 'other.com' }] }, 'https://playbound.club')).toThrow('None of those cookies belong to playbound.club');
    expect(() => sanitizeSessionCookies('nope', 'https://playbound.club')).toThrow('Expected the cookies');
  });
});
