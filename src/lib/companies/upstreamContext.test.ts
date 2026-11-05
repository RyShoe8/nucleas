import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { fillSystemPrompt } from '@/lib/publishing/admin';
import { renderUpstream } from './upstreamContext';

const plan = { summary: 'Summary', audience: 'Audience', positioning: 'Positioning', messagingPillars: ['One'], socialContentPillars: ['Two'], excludedTopics: ['Guaranteed winnings'] };

describe('the overview and plan as prompt context', () => {
  it('keeps what to avoid when everything else is very long', () => {
    const long = 'x'.repeat(50_000);
    const text = renderUpstream({ propertyDescription: long, demographicTarget: long, primaryKeywords: [long] }, { ...plan, summary: long, audience: long, positioning: long, messagingPillars: [long], socialContentPillars: [long] });
    expect(text.length).toBeLessThanOrEqual(3200);
    expect(text).toContain('Avoid: Guaranteed winnings');
  });

  it('is empty for a company with neither', () => {
    expect(renderUpstream(null, null)).toBe('');
  });

  it('includes only the parts that exist', () => {
    expect(renderUpstream({ propertyDescription: 'A casino guide' }, null)).toBe('Company Overview:\n- What it is: A casino guide');
    expect(renderUpstream(null, plan)).toContain('Approved Marketing Plan:');
  });

  it('gives form filling the Voice and strategy, and limits the strategy to wording', () => {
    const prompt = fillSystemPrompt({ companyName: 'Acme', noun: 'deal', brief: '', persona: 'Plain and friendly.', strategy: 'Avoid: Guaranteed winnings' });
    expect(prompt).toContain('Plain and friendly.');
    expect(prompt).toContain('Avoid: Guaranteed winnings');
    expect(prompt).toContain('never a source for amounts');
    expect(fillSystemPrompt({ companyName: 'Acme', noun: 'deal', brief: '' })).not.toContain('Company strategy');
  });
});
