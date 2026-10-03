import { describe, expect, it } from 'vitest';
import { buildBaselineAnalysis, rankAnalysisModels, selectRepresentativeEvidence } from './propertyAnalyzer';

const evidence = [
  {
    url: 'https://playbound.club/', routePattern: '/', title: 'PlayBound — Discover. Play. Connect.',
    description: 'PlayBound finds great free and affordable games with lasting value: memorable solo adventures, strong multiplayer, and mods and total conversions that give you more to play.',
    h1: ['Discover games worth playing'], h2: ['Free and affordable games', 'Play with friends'], metaKeywords: [],
  },
  {
    url: 'https://playbound.club/hosting', routePattern: '/hosting', title: 'Game Server Hosting — PlayBound Dedicated',
    description: 'Split your hosting slots across games, switch whenever you want, and run your game servers through PlayBound.',
    h1: ['Game server hosting'], h2: ['Dedicated game servers'], metaKeywords: [],
  },
  {
    url: 'https://playbound.club/multiplayer', routePattern: '/multiplayer', title: 'Multiplayer — Open Parties and Live Servers',
    description: 'Join open parties, discover live community game servers, and find players across every free and affordable multiplayer title.',
    h1: ['Multiplayer games'], h2: ['Community game servers'], metaKeywords: [],
  },
  {
    url: 'https://playbound.club/games/openra', routePattern: '/games/:game', title: 'OpenRA — Free Multiplayer Game',
    description: 'Discover a free multiplayer strategy game with community servers and mods.',
    h1: ['OpenRA'], h2: ['Multiplayer', 'Mods'], metaKeywords: [],
  },
];

describe('property profile analysis', () => {
  it('extracts useful search phrases and rejects generic isolated words', () => {
    const result = buildBaselineAnalysis(evidence, 'https://playbound.club/');

    expect(result.primaryKeywords).toEqual(expect.arrayContaining(['game server hosting', 'multiplayer games']));
    expect(result.primaryKeywords).not.toEqual(expect.arrayContaining(['friends', 'one', 'roughly']));
    expect(result.demographicTarget).toContain('game server hosting');
  });

  it('uses the same extraction for an unrelated industry and honors explicit audience evidence', () => {
    const businessEvidence = [
      {
        url: 'https://ledger.test/', routePattern: '/', title: 'Accounting Automation Software',
        description: 'Accounting automation software built for small business owners and bookkeeping teams.',
        h1: ['Automated bookkeeping for small businesses'], h2: ['Invoice management software'], metaKeywords: [],
      },
      {
        url: 'https://ledger.test/features/invoicing', routePattern: '/features/:item', title: 'Invoice Management Software',
        description: 'Automate invoice management and bookkeeping workflows for growing businesses.',
        h1: ['Invoice management software'], h2: [], metaKeywords: [],
      },
    ];
    const result = buildBaselineAnalysis(businessEvidence, 'https://ledger.test/');

    expect(result.primaryKeywords).toEqual(expect.arrayContaining(['accounting automation software', 'invoice management software']));
    expect(result.demographicTarget).toContain('small business owners and bookkeeping teams');
  });

  it('keeps several examples per dynamic route while prioritizing core pages', () => {
    const repeated = Array.from({ length: 8 }, (_, index) => ({ ...evidence[3], url: `https://playbound.club/games/game-${index}` }));
    const selected = selectRepresentativeEvidence([...repeated, ...evidence.slice(0, 3)], 20);

    expect(selected[0]?.url).toBe('https://playbound.club/');
    expect(selected.filter((page) => page.routePattern === '/games/:game')).toHaveLength(3);
    expect(selected.some((page) => page.url.endsWith('/hosting'))).toBe(true);
    expect(selected.some((page) => page.url.endsWith('/multiplayer'))).toBe(true);
  });

  it('routes structured synthesis away from visual thinking models when text models are available', () => {
    expect(rankAnalysisModels([
      'Qwen/Qwen3-VL-8B-Thinking-FP8',
      'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ',
      'google/gemma-4-12B-it-qat-w4a16-ct',
    ], 'Qwen/Qwen3-VL-8B-Thinking-FP8')).toEqual([
      'google/gemma-4-12B-it-qat-w4a16-ct',
      'Qwen/Qwen2.5-Coder-14B-Instruct-AWQ',
      'Qwen/Qwen3-VL-8B-Thinking-FP8',
    ]);
  });
});
