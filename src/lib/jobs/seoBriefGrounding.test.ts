import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { marketingPlanCoverageIssues, seoBriefIssues } from './runner';

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
      'PlayBound is a game-server discovery and hosting comparison property for PC gaming communities.',
      new Set(['https://playbound.club/', 'https://playbound.club/games'])
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
            competitors: [],
            geographic_targets: ['Not established'],
          },
          sources: ['https://playbound.club/', 'https://playbound.club/games'],
        }],
        summary: '',
        gaps: [],
      },
      'playbound.club',
      'PlayBound is a game-server discovery and hosting comparison property for PC gaming communities.',
      new Set(['https://playbound.club/', 'https://playbound.club/games'])
    )).toEqual([]);
  });

  it('rejects plausible but unarchived first-party URLs and unsupported competitors or geography', () => {
    const issues = seoBriefIssues(
      {
        records: [{
          values: {
            summary: 'Casino offer tracking.',
            audience: 'Sweepstakes casino players.',
            primary_topics: ['daily casino rewards'],
            positioning: 'Track daily rewards.',
            priority_pages: [{ url: 'https://frugalgambler.club/free-offers', purpose: 'Offers', keywords: ['free offers'] }],
            competitors: ['Made Up Casino Site'],
            geographic_targets: ['Global'],
          },
          sources: ['https://frugalgambler.club/', 'https://frugalgambler.club/free-offers'],
        }],
        summary: '',
        gaps: [],
      },
      'frugalgambler.club',
      'Frugal Gambler tracks sweepstakes casino daily rewards.',
      new Set(['https://frugalgambler.club/', 'https://frugalgambler.club/casinos'])
    );

    const message = issues.map((issue) => issue.problem).join(' ');
    expect(message).toContain('Not found: https://frugalgambler.club/free-offers');
    expect(message).toContain('not found in the archived Company Overview');
    expect(message).toContain('external source URL');
    expect(message).toContain('global or international target');
  });
});

describe('Marketing Plan coverage', () => {
  it('requires verified owned communities and first-party offerings named in company evidence', () => {
    const output = {
      records: [{
        values: {
          social_platforms: ['Facebook', 'Instagram'],
          priority_pages: [{ url: 'https://frugalgambler.club/casinos', purpose: 'Casino catalog', keywords: ['sweepstakes casinos'] }],
        },
        sources: ['https://frugalgambler.club/', 'https://frugalgambler.club/casinos'],
      }],
      summary: '',
      gaps: [],
    };
    const issues = marketingPlanCoverageIssues(
      output,
      [
        { network: 'facebook', url: 'https://facebook.com/TheFrugalGambler' },
        { network: 'reddit', url: 'https://reddit.com/r/TheFrugalGambler' },
      ],
      new Set(['https://frugalgambler.club/', 'https://frugalgambler.club/casinos', 'https://frugalgambler.club/money-feed']),
      'The company provides a money feed that tracks daily sweepstakes casino bonuses.'
    );

    expect(issues.map((issue) => issue.problem).join(' ')).toContain('company-owned reddit');
    expect(issues.map((issue) => issue.problem).join(' ')).toContain('https://frugalgambler.club/money-feed');
  });

  it('accepts plans that cover the verified channels and named offering pages', () => {
    expect(marketingPlanCoverageIssues(
      {
        records: [{
          values: {
            social_platforms: ['Facebook', 'Reddit'],
            priority_pages: [
              { url: 'https://frugalgambler.club/casinos' },
              { url: 'https://frugalgambler.club/money-feed' },
            ],
          },
          sources: [],
        }],
        summary: '',
        gaps: [],
      },
      [
        { network: 'facebook', url: 'https://facebook.com/TheFrugalGambler' },
        { network: 'reddit', url: 'https://reddit.com/r/TheFrugalGambler' },
      ],
      new Set(['https://frugalgambler.club/', 'https://frugalgambler.club/casinos', 'https://frugalgambler.club/money-feed']),
      'The company provides a money feed and a sweepstakes casinos directory.'
    )).toEqual([]);
  });
});
