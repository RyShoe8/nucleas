import { describe, expect, it } from 'vitest';
import { normalizeProductionDomain } from './productionDomain';

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
