import { describe, expect, it } from 'vitest';
import { normalizeProductionDomain, sameSite, siteKey } from './productionDomain';

describe('normalizeProductionDomain', () => {
  it.each([
    ['seniorbydesign.com', 'seniorbydesign.com'],
    ['https://seniorbydesign.com', 'seniorbydesign.com'],
    ['https://www.SeniorByDesign.com/', 'seniorbydesign.com'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeProductionDomain(input)).toEqual({ ok: true, domain: expected });
  });

  it('supports clearing the domain', () => {
    expect(normalizeProductionDomain('  ')).toEqual({ ok: true, domain: null });
  });

  it.each(['localhost', '127.0.0.1', 'ftp://example.com', 'https://example.com/path', 'https://example.com:8443'])('rejects %s', (input) => {
    expect(normalizeProductionDomain(input).ok).toBe(false);
  });
});

describe('siteKey', () => {
  it.each([
    ['www.FrugalGambler.club', 'frugalgambler.club'],
    ['https://www.frugalgambler.club/deals?x=1', 'frugalgambler.club'],
    ['frugalgambler.club.', 'frugalgambler.club'],
    ['sc-domain:frugalgambler.club', 'frugalgambler.club'],
    ['docs.frugalgambler.club', 'docs.frugalgambler.club'],
    ['', ''],
    [null, ''],
  ])('keys %s as %s', (input, expected) => {
    expect(siteKey(input)).toBe(expected);
  });

  it('treats www. and the bare domain as one site, and nothing as no site', () => {
    expect(sameSite('www.playbound.club', 'https://playbound.club/')).toBe(true);
    expect(sameSite('docs.playbound.club', 'playbound.club')).toBe(false);
    expect(sameSite('', '')).toBe(false);
  });
});
