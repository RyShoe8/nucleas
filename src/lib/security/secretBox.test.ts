import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSecret, sealSecret, secretHint } from './secretBox';

describe('secretBox', () => {
  beforeEach(() => {
    vi.stubEnv('NUCLEAS_SECRETS_KEY', 'test-master-key-for-secret-box');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips under the same purpose', () => {
    const sealed = sealSecret('integration:brevo', 'xkeysib-123');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('xkeysib');
    expect(openSecret('integration:brevo', sealed)).toBe('xkeysib-123');
  });

  it('cannot be opened under another purpose', () => {
    const sealed = sealSecret('integration:brevo', 'xkeysib-123');
    expect(() => openSecret('integration:stripe', sealed)).toThrow();
  });

  it('detects tampering', () => {
    const sealed = sealSecret('integration:brevo', 'xkeysib-123');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => openSecret('integration:brevo', tampered)).toThrow();
  });

  it('requires an explicit key in production', () => {
    vi.stubEnv('NUCLEAS_SECRETS_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => sealSecret('integration:brevo', 'x')).toThrow(/NUCLEAS_SECRETS_KEY/);
  });

  it('hints show at most four characters', () => {
    expect(secretHint('sk_live_abcdefgh1234')).toBe('…1234');
    expect(secretHint('short')).toBe('…');
  });
});
