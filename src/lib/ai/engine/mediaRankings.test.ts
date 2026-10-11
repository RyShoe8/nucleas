import { describe, expect, it } from 'vitest';
import { buildMediaRanking, mediaKindOf, parseMediaResponse, type MediaModel, type MediaRow } from './mediaRankings';
import { isTextChatModel } from './catalog';

const row = (over: Partial<MediaRow> & { slug: string; name: string; elo: number }): MediaRow => ({ id: over.slug, creator: 'Lab', rank: null, ci95: null, appearances: null, releaseDate: null, ...over });
const model = (id: string, kind: 'image' | 'video', label = 'OpenAI'): MediaModel => ({ profileId: label, profileLabel: label, model: id, kind });

describe('image and video generation models', () => {
  it('are told apart from chat models, including Sora', () => {
    for (const id of ['sora-2', 'sora-2-pro', 'google/veo-3.1', 'openai/gpt-image-1', 'imagen-4.0-generate-001', 'black-forest-labs/flux-1.1-pro']) {
      expect(isTextChatModel(id)).toBe(false);
      expect(mediaKindOf(id)).not.toBeNull();
    }
    expect(mediaKindOf('sora-2')).toBe('video');
    expect(mediaKindOf('google/veo-3.1')).toBe('video');
    expect(mediaKindOf('openai/gpt-image-1')).toBe('image');
    expect(isTextChatModel('anthropic/claude-sonnet-5.5')).toBe(true);
    expect(mediaKindOf('anthropic/claude-sonnet-5.5')).toBeNull();
  });
});

describe('media leaderboards', () => {
  it('reads Artificial Analysis arena entries and skips ones without an Elo', () => {
    const rows = parseMediaResponse({
      data: [
        { id: 'a1', slug: 'gpt-image-1', name: 'GPT Image 1', model_creator: { name: 'OpenAI' }, elo: 1230.4, rank: 2, ci95: '-5/+5', appearances: 4100, release_date: '2025-04' },
        { id: 'a2', slug: 'no-elo', name: 'No Elo' },
      ],
    });
    expect(rows).toEqual([{ id: 'a1', slug: 'gpt-image-1', name: 'GPT Image 1', creator: 'OpenAI', elo: 1230.4, rank: 2, ci95: '-5/+5', appearances: 4100, releaseDate: '2025-04' }]);
    expect(parseMediaResponse(null)).toEqual([]);
  });

  it('marks what your credentials can use, keeps those rows past the cut-off, and lists the rest as unmatched', () => {
    const rows = [
      row({ slug: 'top-model', name: 'Top Model', elo: 1300, rank: 1 }),
      row({ slug: 'second-model', name: 'Second Model', elo: 1250, rank: 2 }),
      row({ slug: 'gpt-image-1', name: 'GPT Image 1', elo: 1100, rank: 9, creator: 'OpenAI' }),
    ];
    const ranking = buildMediaRanking({
      rows,
      available: [model('gpt-image-1', 'image'), model('some-new-image-model', 'image', 'OpenRouter')],
      limit: 2,
    });
    expect(ranking.rows.map((r) => r.name)).toEqual(['Top Model', 'Second Model', 'GPT Image 1']);
    expect(ranking.rows[2].available).toEqual([{ profileLabel: 'OpenAI', model: 'gpt-image-1' }]);
    expect(ranking.rows[0].available).toEqual([]);
    expect(ranking.unmatched).toEqual([{ profileLabel: 'OpenRouter', model: 'some-new-image-model' }]);
    expect(ranking.total).toBe(3);
  });

  it('matches a provider id to a leaderboard name regardless of prefix and word order', () => {
    const ranking = buildMediaRanking({ rows: [row({ slug: 'veo-3', name: 'Veo 3', elo: 1200, rank: 1 })], available: [model('google/veo-3', 'video', 'OpenRouter')] });
    expect(ranking.rows[0].available).toHaveLength(1);
  });
});
