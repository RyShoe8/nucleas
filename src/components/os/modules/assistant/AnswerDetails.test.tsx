import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnswerDetails, { describeStages, detailsSummary, formatCost } from './AnswerDetails';

const stages = [
  { stage: 'plan', model: 'openai/gpt-6.1-sol', free: false, costMicros: 4000 },
  { stage: 'fetch', note: '0 job(s), 2 web search(es), no model' },
  { stage: 'work', model: 'google/gemma-4-12B-it-qat-w4a16-ct', free: true, costMicros: 0 },
  { stage: 'check', note: 'all 6 numbers found in the data' },
];
const evidence = {
  sources: [{ url: 'https://www.ign.com/review', title: 'IGN review', snippet: 'A review of the game', cited: true }, { url: 'https://other.com/', title: 'Other page' }],
  images: [{ imageUrl: 'https://cdn.com/cover.png', title: 'Cover', pageUrl: 'https://www.ign.com/review' }],
  data: [{ label: 'PlayBound · company_metrics', detail: 'Visitors: 1,200' }],
};
const render = (props: Parameters<typeof AnswerDetails>[0]) => renderToStaticMarkup(createElement(AnswerDetails, props));

describe('how an answer was made, in plain words', () => {
  it('names each step and its model, and says when no model was used', () => {
    expect(describeStages(stages)).toEqual([
      { name: 'Planned the approach', detail: undefined, model: 'gpt-6.1-sol', cost: '<$0.01', warning: false },
      { name: 'Gathered information', detail: '2 web searches', cost: 'No model' },
      { name: 'Wrote the answer', detail: undefined, model: 'gemma-4-12B', cost: 'Free', warning: false },
      { name: 'Checked the numbers', detail: 'All 6 numbers found in the data', cost: 'No model', warning: false },
    ]);
  });

  it('reads tool names as words', () => {
    expect(describeStages([{ stage: 'research', model: 'x/y', free: true, note: 'tools: web_search, web_fetch' }])[0]?.detail).toBe('Used web search, web fetch');
  });

  it('leaves out a lookup step that looked up nothing', () => {
    expect(describeStages([{ stage: 'fetch', note: '0 job(s), no model' }])).toEqual([]);
  });

  it('combines lookups and singular wording correctly', () => {
    expect(describeStages([{ stage: 'fetch', note: '1 job(s), 1 web search(es), no model' }])[0]?.detail).toBe('1 company data lookup and 1 web search');
  });

  it('flags numbers that did not check out, and skipped steps', () => {
    expect(describeStages([{ stage: 'check', note: '2 numbers not found' }])[0]).toMatchObject({ name: 'Numbers need a look', warning: true });
    expect(describeStages([{ stage: 'research', note: 'skipped: no model available for research' }])[0]?.warning).toBe(true);
  });

  it('never calls a paid step with no known cost free', () => {
    expect(describeStages([{ stage: 'work', model: 'x/paid', free: false }])[0]?.cost).toBe('Unknown');
  });

  it('formats costs', () => {
    expect([formatCost(0), formatCost(4000), formatCost(370_000)]).toEqual(['$0.00', '<$0.01', '$0.37']);
  });

  it('summarizes what is inside, with correct singulars', () => {
    expect(detailsSummary({ evidence, steps: describeStages(stages), costMicros: 4000 })).toBe('2 sources · 1 image · 1 data lookup · 4 steps · <$0.01');
  });
});

describe('the details under an answer', () => {
  it('shows nothing when there is nothing to show', () => {
    expect(render({})).toBe('');
  });

  it('shows only the cost, with no button, when that is all there is', () => {
    const html = render({ costMicros: 370_000 });
    expect(html).toContain('$0.37');
    expect(html).not.toContain('<button');
  });

  it('links context that is a web address, and only a safe one', () => {
    const html = render({ contextSources: ['https://site.com/a', 'javascript:alert(1)', 'company profile'], defaultOpen: true });
    expect(html).toContain('href="https://site.com/a"');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('company profile');
  });

  it('starts as one quiet line, with nothing below it loaded', () => {
    const html = render({ stages, evidence, costMicros: 4000 });
    expect(html).toContain('2 sources · 1 image');
    expect(html).toContain('Show details');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('IGN review');
  });

  it('opens into organized sections', () => {
    const html = render({ stages, evidence, costMicros: 4000, contextSources: ['company profile'], defaultOpen: true });
    for (const heading of ['How this was answered', 'Sources · 2', 'Images · 1', 'Company data used · 1', 'Company context']) expect(html).toContain(heading);
    expect(html).toContain('Planned the approach');
    expect(html).toContain('href="https://www.ign.com/review"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('ign.com · used in the answer');
    expect(html).toContain('A review of the game');
    expect(html).toContain('https://cdn.com/cover.png');
    expect(html).toContain('no-referrer');
    expect(html).toContain('Visitors: 1,200');
    expect(html).toContain('Total');
  });

  it('shows page text as text, never as markup', () => {
    const html = render({ evidence: { sources: [{ url: 'https://x.com/', title: '<script>alert(1)</script>' }], images: [], data: [] }, defaultOpen: true });
    expect(html).not.toContain('<script>');
  });
});
