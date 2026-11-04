import { describe, expect, it } from 'vitest';
import { parseAnswerSlides } from './answerSlides';

const slide = (title: string) => `## ${title}\nA reported fact. [Source](https://example.com/report)\n`;
describe('Ask slideshow format', () => {
  it('restores a sourced briefing from persisted markdown', () => {
    expect(parseAnswerSlides('<!-- nucleas-slides -->\n' + ['Result', 'Impact', 'Next'].map(slide).join('\n'))?.map(s => s.title)).toEqual(['Result', 'Impact', 'Next']);
  });
  it('keeps ordinary answers as text', () => {
    expect(parseAnswerSlides(slide('Answer'))).toBeNull();
  });
  it('falls back to text when a slide lacks a source or uses an unsafe URL', () => {
    const content = '<!-- nucleas-slides -->\n' + slide('Result') + slide('Impact');
    expect(parseAnswerSlides(content + '## Next\nUnsupported')).toBeNull();
    expect(parseAnswerSlides(content + '## Next\n[Bad](javascript:alert)')).toBeNull();
  });
});
