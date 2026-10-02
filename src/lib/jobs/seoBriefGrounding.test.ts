import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { seoBriefIssues } from './runner';

describe('SEO brief grounding', () => {
  it('rejects unsupported market identity, missing first-party citations, and relative pages', () => {
    const issues = seoBriefIssues(
      {
        records: [{
          values: {
            summary: 'Educational games for children.',
            audience: 'Parents and teachers.',
            primary_topics: ['education'],
            positioning: 'Learning through play.',
            priority_pages: JSON.stringify([{ url: '/games', purpose: 'Games', keywords: ['games'] }]),
          },
          sources: [],
        }],
        summary: '',
        gaps: [],
      },
      'playbound.club',
      'PlayBound is a game-server discovery and hosting comparison property for PC gaming communities.'
    );

    expect(issues.map((issue) => issue.problem).join(' ')).toContain('two first-party');
    expect(issues.map((issue) => issue.problem).join(' ')).toContain('absolute URL');
    expect(issues.map((issue) => issue.problem).join(' ')).toContain('without that concept');
  });

  it('accepts sourced claims and absolute priority pages on the selected property', () => {
    expect(seoBriefIssues(
      {
        records: [{
          values: {
            summary: 'Game-server discovery and hosting comparison.',
            audience: 'PC gaming communities looking for servers.',
            primary_topics: ['game servers'],
            positioning: 'Find and compare community game servers.',
            priority_pages: [{ url: 'https://playbound.club/games', purpose: 'Game catalog', keywords: ['game servers'] }],
          },
          sources: ['https://playbound.club/', 'https://playbound.club/games'],
        }],
        summary: '',
        gaps: [],
      },
      'playbound.club',
      'PlayBound is a game-server discovery and hosting comparison property for PC gaming communities.'
    )).toEqual([]);
  });
});
