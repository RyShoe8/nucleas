import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/publishing/fetchPublic', () => ({ fetchPublic: vi.fn() }));

import { evidenceProblems, judgePrompt, quotedPassages, verifyOpportunity, type Judge, type PageReading, type ReadPage } from './opportunityPages';

const URL1 = 'https://directory.example/submit/';
const PAGE: PageReading = { url: URL1, finalUrl: URL1, title: 'Submit your site', description: 'Add your resource to our free directory.', text: 'Submit your site for free. Our directory lists helpful tools for budget gamers and accepts suggestions through the form below.' };
const GOOD_EVIDENCE = 'The page says "Submit your site for free" and lists tools for budget gamers, which matches the audience.';
const company = { name: 'Frugal Gambler', description: 'Bonus tracking for sweepstakes casino players' };

const reads = (answers: Record<string, Awaited<ReturnType<ReadPage>>>): ReadPage => async (url) => answers[url] ?? { ok: false, status: null, reason: 'The page could not be reached.' };
const pass: Judge = async () => ({ verdict: 'pass', reason: 'A free directory with a submission form.' });

describe('evidence quotes', () => {
  it('finds long quoted passages, straight or curly', () => {
    expect(quotedPassages('He said "short" and "Submit your site for free, it only takes a minute." then “Another long passage copied from the page text”.')).toEqual(['Submit your site for free, it only takes a minute.', 'Another long passage copied from the page text']);
  });

  it('requires a quote, and that a quote really appears on the page (spacing, case and curly quotes ignored)', () => {
    expect(evidenceProblems('It looks relevant and useful for the audience.', PAGE)[0]).toMatch(/quotes nothing/);
    expect(evidenceProblems('The page says "We are the best casino directory in the world today" so it fits.', PAGE)[0]).toMatch(/None of the passages/);
    expect(evidenceProblems(GOOD_EVIDENCE, PAGE)).toEqual([]);
    expect(evidenceProblems('It says "SUBMIT   your site for  free" clearly.'.replace('your site for  free', 'your site for free'), PAGE)).toEqual([]);
  });
});

describe('verifying a recommended opportunity', () => {
  it('passes a real page with real evidence and a passing judge', async () => {
    expect(await verifyOpportunity({ url: URL1, evidence: GOOD_EVIDENCE, claimedType: 'directory', company }, { read: reads({ [URL1]: { ok: true, page: PAGE } }), judge: pass })).toEqual({ hard: [], soft: [] });
  });

  it('rejects an address that does not exist, even when the write-up is convincing', async () => {
    const out = await verifyOpportunity({ url: 'https://casinoverse.com/submit-a-site/', evidence: GOOD_EVIDENCE, claimedType: 'directory', company }, { read: reads({ 'https://casinoverse.com/submit-a-site/': { ok: false, status: 404, reason: 'The page returned HTTP 404.' } }), judge: pass });
    expect(out.hard[0]).toMatch(/does not exist/);
    expect(out.missing).toBe(true);
    expect(out.soft).toEqual([]);
  });

  it('only asks a person to check pages Nucleas could not open, instead of rejecting them', async () => {
    const out = await verifyOpportunity({ url: URL1, evidence: GOOD_EVIDENCE, claimedType: 'directory', company }, { read: reads({ [URL1]: { ok: false, status: 403, reason: 'The page returned HTTP 403.' } }), judge: pass });
    expect(out.hard).toEqual([]);
    expect(out.missing).not.toBe(true);
    expect(out.soft[0]).toMatch(/could not be opened by Nucleas/);
  });

  it('permanently excludes gone pages but not transient server errors or invalid file types', async () => {
    for (const status of [410, 500, null]) {
      const out = await verifyOpportunity({ url: URL1, evidence: GOOD_EVIDENCE, claimedType: 'directory', company }, {
        read: reads({ [URL1]: { ok: false, status, reason: status === null ? 'The address is a file, not a web page.' : `The page returned HTTP ${status}.` } }),
      });
      expect(Boolean(out.missing)).toBe(status === 410);
    }
  });

  it('rejects a site the judge says is not what was claimed, using the homepage as context', async () => {
    const seen: string[] = [];
    const judge: Judge = async (input) => {
      seen.push(input.home?.title ?? 'no home');
      return { verdict: 'fail', reason: 'The site is a casino resort, not a directory.' };
    };
    const out = await verifyOpportunity(
      { url: URL1, evidence: GOOD_EVIDENCE, claimedType: 'directory', company },
      { read: reads({ [URL1]: { ok: true, page: PAGE }, 'https://directory.example/': { ok: true, page: { ...PAGE, finalUrl: 'https://directory.example/', title: 'Wind Creek Casino', description: 'Resort and casino' } } }), judge }
    );
    expect(seen).toEqual(['Wind Creek Casino']);
    expect(out.hard).toEqual([expect.stringContaining('casino resort, not a directory')]);
  });

  it('does not block when no judge answers, and still enforces the quote rule', async () => {
    const read = reads({ [URL1]: { ok: true, page: PAGE } });
    expect((await verifyOpportunity({ url: URL1, evidence: GOOD_EVIDENCE, claimedType: '', company }, { read, judge: async () => null })).hard).toEqual([]);
    expect((await verifyOpportunity({ url: URL1, evidence: 'Looks great.', claimedType: '', company }, { read })).hard[0]).toMatch(/quotes nothing/);
    expect((await verifyOpportunity({ url: ' ', evidence: '', claimedType: '', company }, { read })).hard[0]).toMatch(/no opportunity page address/);
  });

  it('gives the judge the page and a prompt that treats it as untrusted data', () => {
    const prompt = judgePrompt({ company, page: PAGE, home: null, claimedType: 'directory' });
    expect(prompt.system).toMatch(/untrusted data/);
    expect(prompt.system).toMatch(/not pay-to-play|pay-to-play/);
    expect(prompt.user).toContain(PAGE.text);
    expect(prompt.user).toContain('Frugal Gambler');
  });
});
