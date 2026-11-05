import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserNavigate: vi.fn() }));
import { prospectQualification, qualifySignatureProspect } from './signatureQualification';
describe('signature prospect qualification', () => {
  const candidate = {
    website: 'https://smallcompany.com', social: 'https://bsky.app/profile/smallcompany.com', team_size: 10,
    team_source: 'https://smallcompany.com/team', team_quote: 'We are a company of ten people.',
    growth_source: 'https://smallcompany.com/news', growth_quote: 'We launched our new product this month.', growth_date: '2026-11-01',
  };
  it('rejects large companies and unsupported social networks', () => {
    expect(prospectQualification.safeParse(candidate).success).toBe(true);
    expect(prospectQualification.safeParse({ ...candidate, team_size: 100 }).success).toBe(false);
    expect(prospectQualification.safeParse({ ...candidate, social: 'https://twitter.com/company' }).success).toBe(false);
    expect(prospectQualification.safeParse({ ...candidate, social: 'https://www.facebook.com/company' }).success).toBe(false);
  });
  it('accepts a one-person company, stated in a founder\'s own short words', () => {
    expect(prospectQualification.safeParse({ ...candidate, team_size: 1, team_quote: 'I run this solo.' }).success).toBe(true);
    expect(prospectQualification.safeParse({ ...candidate, team_size: 0 }).success).toBe(false);
    expect(prospectQualification.safeParse({ ...candidate, team_quote: 'Solo.' }).success).toBe(false);
  });
  it('rejects a post with a link, and allows a tagged handle', async () => {
    for (const post of ['@smallcompany Love this. Try tailnote.io', '@smallcompany See https://example.com', '@smallcompany See www.example.com']) {
      await expect(qualifySignatureProspect({ ...candidate, post }, [], [], true)).rejects.toThrow('Leave every link out');
    }
    await expect(qualifySignatureProspect({ ...candidate, post: '@smallcompany.com How did the launch go? cc @tailnote.io' }, [], [], true)).rejects.toThrow('Cite the exact');
  });
  it('rejects owned companies and missing citations before opening any pages', async () => {
    await expect(qualifySignatureProspect(candidate, [], ['smallcompany.com'], true)).rejects.toThrow('Owned properties');
    await expect(qualifySignatureProspect(candidate, [], [], true)).rejects.toThrow('Cite the exact');
  });
});
