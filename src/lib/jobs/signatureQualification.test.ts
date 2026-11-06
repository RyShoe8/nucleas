import { describe, it, expect, vi } from 'vitest';
const worker = vi.hoisted(() => ({ navigate: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserNavigate: worker.navigate, browserFetch: worker.fetch }));
import { dateOnPage, looksLikeLogo, officialPublishingHosts, prospectQualification, publishingHostsIn, qualifySignatureProspect, quoteOnPage, teamEvidenceProblem, tidyPost } from './signatureQualification';
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
  it.each([
    ['I run this solo.'], ['A small team of 12 building newsletters.'], ['Our team page lists Ana, Ben and Cy.'],
    ['Trusted by 5,000 customers and 300 newsletters.'], ['We are a 25-person company.'],
  ])('accepts small-company evidence without an exact count: %s', (quote) => {
    expect(teamEvidenceProblem(quote)).toBeNull();
  });
  it.each([['We are a team of 40.', 40], ['Over 1,200 employees worldwide.', 1200], ['A 60-person company.', 60]])('refuses a quote that says too many: %s', (quote, size) => {
    expect(teamEvidenceProblem(quote)).toContain(String(size));
  });
  it('finds a hosted blog by its own address, including one that is only embedded', () => {
    const html = '<iframe src="https://gilarpgs.substack.com/embed"></iframe><a href="https://www.substack.com/">x</a><img src="https://cdn.substack.com/a.png"><a href="https://techcrunch.com/story">news</a>';
    expect([...publishingHostsIn(html)]).toEqual(['gilarpgs.substack.com']);
  });

  it('treats an unreadable homepage as proving nothing', async () => {
    worker.fetch.mockRejectedValueOnce(new Error('blocked'));
    expect(await officialPublishingHosts('https://smallcompany.com/')).toEqual(new Set());
  });

  describe('growth evidence on a hosted blog', () => {
    const blog = 'https://smallco.substack.com/p/launch';
    const values = { ...candidate, growth_source: blog, growth_date: new Date().toISOString().slice(0, 10), person_source: 'https://smallcompany.com/team', contact_source: 'https://smallcompany.com/team', cta_url: 'https://smallcompany.com/buy' };
    const sources = [candidate.team_source, blog, 'https://smallcompany.com/buy'];
    const opened = () => worker.navigate.mockImplementation(async (url: string) => ({ url, text: `${candidate.team_quote} ${candidate.growth_quote}` }));

    it('counts when the homepage points to that exact blog', async () => {
      opened();
      worker.fetch.mockResolvedValueOnce({ body: '<iframe src="https://smallco.substack.com/embed"></iframe>' });
      await expect(qualifySignatureProspect(values, sources, [], false)).resolves.toContain('Opened primary source');
    });

    it('does not count when the homepage points elsewhere', async () => {
      worker.fetch.mockResolvedValueOnce({ body: '<a href="https://other.substack.com/">a friend</a>' });
      await expect(qualifySignatureProspect(values, sources, [], false)).rejects.toThrow('official site');
    });

    it('never counts news coverage', async () => {
      worker.fetch.mockResolvedValueOnce({ body: '<a href="https://techcrunch.com/story">press</a>' });
      await expect(qualifySignatureProspect({ ...values, growth_source: 'https://techcrunch.com/story' }, sources, [], false)).rejects.toThrow('official site');
    });
  });

  describe('telling a logo from any other image', () => {
    it.each([
      ['https://buttondown.com/_next/static/media/hero-illustration-desktop-left.1av51urbta5tf.svg', 'Buttondown'],
      ['https://philreichert.org/blob/index-twitter.jpg', 'Phil Reichert'],
      ['https://gilarpgs.com/cdn/shop/files/UNDERGROWTH_copy.png?v=1', 'Gila RPGs'],
      ['not a url', 'Gila RPGs'],
    ])('refuses %s', (url, company) => { expect(looksLikeLogo(url, company)).toBe(false); });
    it.each([
      ['https://gilarpgs.com/cdn/shop/files/GilaLogo_Primary_900px.png?v=1', 'Gila RPGs'],
      ['https://transistor.fm/transistor-mark.svg', 'Transistor'],
      ['https://pandiongames.com/cdn/shop/files/Pandion_Games_e1e55b44.png', 'Pandion Games'],
      ['https://site.com/assets/wordmark.svg', 'Acme'],
    ])('accepts %s', (url, company) => { expect(looksLikeLogo(url, company)).toBe(true); });
  });

  describe('finding a date on a page', () => {
    it.each(['Posted October 24, 2026', 'Oct 24th, 2026', '24 October 2026', 'Oct. 24 2026', 'on 10/24/2026', 'published 2026-10-24T09:00'])('finds it in: %s', (text) => {
      expect(dateOnPage(text, '2026-10-24')).toBe(true);
    });
    it('does not accept a different date, or a bad one', () => {
      expect(dateOnPage('Posted October 25, 2026', '2026-10-24')).toBe(false);
      expect(dateOnPage('October 24, 2025', '2026-10-24')).toBe(false);
      expect(dateOnPage('October 2, 2026', '2026-10-24')).toBe(false);
      expect(dateOnPage('anything', 'soon')).toBe(false);
    });
  });

  it('replaces dashes in a post', () => {
    expect(tidyPost('We made you a concept—not requested — featuring your article.')).toBe('We made you a concept, not requested, featuring your article.');
    expect(tidyPost('A well-made co-op game.')).toBe('A well-made co-op game.');
  });

  it('refuses an image that is not the logo, before opening any pages', async () => {
    await expect(qualifySignatureProspect({ ...candidate, company: 'Small Company', logo: 'https://smallcompany.com/hero-illustration.svg' }, [], [], true)).rejects.toThrow('does not look like');
  });

  describe('finding a quote on a page', () => {
    it('ignores quote marks, dashes, case and spacing', () => {
      expect(quoteOnPage('We’re a team of 11 — “bootstrapped”  and independent.', "we're a team of 11 - \"bootstrapped\" and independent")).toBe(true);
    });
    it('reads a quote copied from a page shown as markdown', () => {
      const page = "Here's our team: Jon Buda, Co-founder, President Justin Jackson, Co-founder, CEO Helen Ryles, Customer Success";
      const quote = "Here's our team: - **Jon Buda**, Co-founder, President - **Justin Jackson**, Co-founder, CEO - [Helen Ryles](https://transistor.fm/helen/), Customer Success";
      expect(quoteOnPage(page, quote)).toBe(true);
    });
    it('still requires the same words in the same order', () => {
      expect(quoteOnPage('We are a team of 11 people.', 'We are a team of 12 people.')).toBe(false);
      expect(quoteOnPage('Launched our new product.', 'Our new product launched.')).toBe(false);
    });
    it('matches whole words only', () => {
      expect(quoteOnPage('a team of 110 people', 'team of 11')).toBe(false);
    });
    it('never matches an empty quote', () => {
      expect(quoteOnPage('anything', '— —')).toBe(false);
    });
  });

  it('says which quote failed and where', async () => {
    worker.navigate.mockImplementation(async (url: string) => ({ url, text: 'markdown', plainText: candidate.growth_quote }));
    const values = { ...candidate, growth_date: new Date().toISOString().slice(0, 10), person_source: candidate.team_source, contact_source: candidate.team_source, cta_url: 'https://smallcompany.com/buy' };
    await expect(qualifySignatureProspect(values, [candidate.team_source, candidate.growth_source, 'https://smallcompany.com/buy'], [], false)).rejects.toThrow('The team quote was not found on https://smallcompany.com/team');
  });

  it('checks quotes against the whole page, not the shortened copy', async () => {
    worker.navigate.mockImplementation(async (url: string) => ({ url, text: 'shortened', plainText: `${candidate.team_quote} ${candidate.growth_quote}` }));
    const values = { ...candidate, growth_date: new Date().toISOString().slice(0, 10), person_source: candidate.team_source, contact_source: candidate.team_source, cta_url: 'https://smallcompany.com/buy' };
    await expect(qualifySignatureProspect(values, [candidate.team_source, candidate.growth_source, 'https://smallcompany.com/buy'], [], false)).resolves.toContain('Opened primary source');
  });

  it('names the missing field instead of saying a URL is invalid', async () => {
    await expect(qualifySignatureProspect({ ...candidate, growth_date: new Date().toISOString().slice(0, 10) }, [candidate.team_source, candidate.growth_source], [], true)).rejects.toThrow('Missing person_source.');
  });

  it('refuses a post with a bracketed placeholder', async () => {
    await expect(qualifySignatureProspect({ ...candidate, post: '@smallcompany.com Nice launch. [Unsolicited Concept: Signature]' }, [], [], true)).rejects.toThrow('bracketed');
  });

  it('rejects owned companies and missing citations before opening any pages', async () => {
    await expect(qualifySignatureProspect(candidate, [], ['smallcompany.com'], true)).rejects.toThrow('Owned properties');
    await expect(qualifySignatureProspect(candidate, [], [], true)).rejects.toThrow('Cite the exact');
  });
});
