import { describe, expect, it } from 'vitest';
import { parseJobOutput } from './output';

const profile = { positioning: { primary: 'Practical game discovery' }, audienceRelationship: { style: 'Fellow players' }, rhetoricalPatterns: ['Concrete recommendations'] };
const record = { values: { brand_profile: profile }, sources: ['https://playbound.club/'] };
describe('job output recovery', () => {
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
