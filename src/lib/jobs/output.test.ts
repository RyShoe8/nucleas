import { describe, expect, it } from 'vitest';
import { parseJobOutput, replyProblem } from './output';

const profile = { positioning: { primary: 'Practical game discovery' }, audienceRelationship: { style: 'Fellow players' }, rhetoricalPatterns: ['Concrete recommendations'] };
const record = { values: { brand_profile: profile }, sources: ['https://playbound.club/'] };
describe('job output recovery', () => {
  it('recovers the Spotlight flat record and named citations without a model rewriting the evidence', () => {
    const values = { name: 'Plausible Analytics', website: 'https://plausible.io/', team_size: 11,
      team_quote: 'Today Plausible is a team of 11.', growth_date: '2026-11-02', growth_quote: 'We launched our GTM template.',
      contact_email: 'hello@plausible.io', person_role: 'Founder', logo_url: 'https://plausible.io/logo.svg',
      layout: 'modern_professional', cta_text: 'Start free trial', social_draft: 'A concept for @plausible.io',
      sources: { team_source: 'https://plausible.io/about', growth_source: 'https://plausible.io/changelog', cta_url: 'https://plausible.io/register' } };
    const parsed = parseJobOutput('```json\n' + JSON.stringify(values) + '\n```\nVerification notes: unverified colors.', 'signature_outreach');
    expect(parsed).toMatchObject({ success: true, data: { records: [{ values: {
      company: values.name, team_size: 11, team_quote: values.team_quote, growth_date: values.growth_date, growth_quote: values.growth_quote,
      email: values.contact_email, role: values.person_role, logo: values.logo_url, preset: values.layout,
      cta_label: values.cta_text, cta_url: values.sources.cta_url, post: values.social_draft,
    }, sources: Object.values(values.sources) }] } });
    if (parsed.success) expect(parsed.data.records[0].values.first_name).toBeUndefined();
  });
  it('maps declared field labels without guessing missing link-building facts or fixing invalid numbers', () => {
    const fields = [
      { key: 'opportunity_url', label: 'Opportunity', type: 'url' as const, required: true, description: '' },
      { key: 'relevance_score', label: 'Relevance score', type: 'number' as const, required: true, description: '' },
    ];
    const parsed = parseJobOutput(JSON.stringify({ records: [{ values: { Opportunity: 'https://directory.test/submit', 'Relevance score': 'unknown' }, sources: { submission: 'https://directory.test/submit' } }] }), 'link_building', fields);
    expect(parsed).toMatchObject({ success: true, data: { records: [{ values: { opportunity_url: 'https://directory.test/submit', relevance_score: 'unknown' }, sources: ['https://directory.test/submit'] }] } });
    if (parsed.success) expect(parsed.data.records[0].values.authority_basis).toBeUndefined();
  });
  it('recovers a marketing record between unrelated JSON fragments without treating braces inside a string as delimiters', () => {
    const plan = { values: { summary: 'A {branded} signature' }, sources: ['https://tailnote.io/'] };
    const text = 'Research {"tool":"search"} Final ' + JSON.stringify({ records: [plan] }) + ' End {"status":"done"}';
    expect(parseJobOutput(text, 'marketing_plan')).toMatchObject({ success: true, data: { records: [plan] } });
    expect(replyProblem('<think>unfinished')).toContain('no final answer');
    expect(replyProblem('Here is the strategy')).toContain('prose');
  });
  it('keeps a generated persona when source citations exceed the storage limit', () => {
    const sources = Array.from({ length: 27 }, (_, i) => `https://playbound.club/games/${i}`);
    const parsed = parseJobOutput(JSON.stringify({ records: [{ values: record.values, sources: [sources[0], ...sources, ' '] }] }), 'brand_voice');
    expect(parsed).toMatchObject({ success: true, data: { records: [{ values: record.values, sources: sources.slice(0, 20) }] } });
  });
  it('reads a source written as an object with a real address', () => {
    const parsed = parseJobOutput(JSON.stringify({ records: [{ ...record, sources: [{ type: 'team_page', url: 'https://playbound.club/team', description: 'Team' }] }] }), 'brand_voice');
    expect(parsed).toMatchObject({ success: true, data: { records: [{ sources: ['https://playbound.club/team'] }] } });
  });
  it('still rejects malformed sources rather than hiding them past the cap', () => {
    expect(parseJobOutput(JSON.stringify({ records: [{ ...record, sources: [...Array(21).fill('https://playbound.club/'), { url: 'invalid shape' }] }] }), 'brand_voice').success).toBe(false);
  });
  it('reads JSON after reasoning and an irrelevant fence', () => {
    const text = '<think>I should return {something}.</think>```text\nWorking\n```\n```json\n' + JSON.stringify({ records: [record] }) + '\n```';
    expect(parseJobOutput(text, 'brand_voice')).toMatchObject({ success: true, data: { records: [record] } });
  });
  it('normalizes a top-level Voice field without fabricating sources', () => {
    expect(parseJobOutput(JSON.stringify({ brand_profile: profile, sources: record.sources }), 'brand_voice')).toMatchObject({ success: true, data: { records: [record] } });
    expect(parseJobOutput(JSON.stringify({ brand_profile: profile }), 'brand_voice')).toMatchObject({ success: true, data: { records: [{ sources: [] }] } });
  });
  it('accepts arrays and JSON encoded as a string', () => {
    expect(parseJobOutput(JSON.stringify([record])).success).toBe(true);
    expect(parseJobOutput(JSON.stringify(JSON.stringify({ records: [record] }))).success).toBe(true);
  });
  it('rejects incomplete JSON and does not invent a profile from prose', () => {
    expect(parseJobOutput('{"records": [{', 'brand_voice').success).toBe(false);
    expect(parseJobOutput('The brand sounds friendly.', 'brand_voice').success).toBe(false);
  });
});
