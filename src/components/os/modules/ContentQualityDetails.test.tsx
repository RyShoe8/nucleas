import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ContentQualityDetails from './ContentQualityDetails';
import { evaluateQuality } from '@/lib/ai/research/contentQuality';

describe('shared quality results', () => {
  it('keeps review failure explicit even when there are no sources', () => {
    const html = renderToStaticMarkup(createElement(ContentQualityDetails, { quality: evaluateQuality(null, [], []) }));
    expect(html).toContain('Evidence review incomplete');
    expect(html).toContain('draft is retained');
    expect(html).not.toContain('checks passed');
  });
  it('does not add a quality verdict to legacy results', () => {
    expect(renderToStaticMarkup(createElement(ContentQualityDetails, {}))).toBe('');
  });
});
