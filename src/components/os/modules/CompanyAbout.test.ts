import { describe, expect, it } from 'vitest';
import { fromDraft, toDraft } from './CompanyAbout';
import { briefLead } from './jobs/JobCard';
import type { FactValues } from '@/lib/companies/companyFacts';

const values: FactValues = {
  description: 'Email signatures that update themselves.',
  audience: 'Small teams.',
  keywords: ['email signature generator', 'team signatures'],
  competitors: [{ name: 'Wisestamp', domain: 'wisestamp.com', note: 'largest free generator' }, { name: 'Newoldstamp' }],
  keyFacts: 'Free for up to three people.',
};

describe('editing company information', () => {
  it('shows lists one per line and reads them back the same', () => {
    expect(toDraft('keywords', values)).toBe('email signature generator\nteam signatures');
    expect(fromDraft('keywords', toDraft('keywords', values))).toEqual(values.keywords);
    expect(toDraft('competitors', values)).toBe('Wisestamp, wisestamp.com, largest free generator\nNewoldstamp');
    expect(fromDraft('competitors', toDraft('competitors', values))).toEqual(values.competitors);
  });

  it('copes with how people actually type a list', () => {
    expect(fromDraft('keywords', '- email signature generator\n\n* team signatures\nemail signature generator')).toEqual(['email signature generator', 'team signatures']);
    expect(fromDraft('competitors', 'Wisestamp, https://www.wisestamp.com/pricing\nMySignature, strong on templates, cheap')).toEqual([
      { name: 'Wisestamp', domain: 'www.wisestamp.com' },
      { name: 'MySignature', note: 'strong on templates, cheap' },
    ]);
    expect(fromDraft('description', '  Signatures that update themselves.  ')).toBe('Signatures that update themselves.');
  });
});

describe('the plan card', () => {
  it('leads with the first whole sentences of the brief, not a cut-off one', () => {
    const brief = `Find one small company that grew this year. ${'Check its site and its Bluesky profile carefully before choosing it. '.repeat(8)}`;
    const lead = briefLead(brief);
    expect(lead.length).toBeLessThanOrEqual(320);
    expect(lead.startsWith('Find one small company that grew this year.')).toBe(true);
    expect(lead.endsWith('.')).toBe(true);
    expect(briefLead('Post each new deal.')).toBe('Post each new deal.');
  });
});
