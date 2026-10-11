import { modelKey } from './benchmarks';

export type MediaKind = 'image' | 'video';

/** One leaderboard entry from Artificial Analysis's text-to-image or text-to-video arena (Elo from blind votes). */
export interface MediaRow {
  id: string;
  slug: string;
  name: string;
  creator: string;
  elo: number;
  rank: number | null;
  /** Confidence interval as the leaderboard prints it, e.g. "-5/+5". */
  ci95: string | null;
  appearances: number | null;
  releaseDate: string | null;
}

/** An image or video generation model a credential lists. */
export interface MediaModel {
  profileId: string;
  profileLabel: string;
  model: string;
  kind: MediaKind;
}

export interface MediaRankRow {
  rank: number | null;
  name: string;
  creator: string;
  elo: number;
  ci95: string | null;
  appearances: number | null;
  releaseDate: string | null;
  /** The credentials that list this model, so you can see what you can actually use. */
  available: { profileLabel: string; model: string }[];
}

export interface MediaRanking {
  rows: MediaRankRow[];
  /** Models your credentials list that are not on the leaderboard (new, niche, or not yet voted on). */
  unmatched: { profileLabel: string; model: string }[];
  total: number;
}

const VIDEO = /(sora|veo|video|kling|hailuo|runway|luma|ray-?\d|seedance|wan-?\d)/i;
const IMAGE = /(image|imagen|dall-e|nano-banana|flux|stable-diffusion|sdxl|seedream|ideogram|recraft|midjourney|firefly|hidream|qwen-image)/i;

/** Whether a listed model id generates video or images (these are not chat models). Video wins when both match. */
export function mediaKindOf(id: string): MediaKind | null {
  const bare = id.replace(/^.*\//, '');
  if (VIDEO.test(bare)) return 'video';
  if (IMAGE.test(bare)) return 'image';
  return null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseMediaResponse(body: unknown): MediaRow[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const r = raw as { id?: unknown; slug?: unknown; name?: unknown; model_creator?: { name?: unknown }; elo?: unknown; rank?: unknown; ci95?: unknown; appearances?: unknown; release_date?: unknown };
    const elo = num(r.elo);
    const slug = typeof r.slug === 'string' ? r.slug : typeof r.id === 'string' ? r.id : null;
    if (elo === null || !slug) return [];
    return [
      {
        id: typeof r.id === 'string' ? r.id : slug,
        slug,
        name: typeof r.name === 'string' ? r.name : slug,
        creator: typeof r.model_creator?.name === 'string' ? r.model_creator.name : '',
        elo,
        rank: num(r.rank),
        ci95: typeof r.ci95 === 'string' ? r.ci95 : null,
        appearances: num(r.appearances),
        releaseDate: typeof r.release_date === 'string' ? r.release_date : null,
      },
    ];
  });
}

/**
 * The leaderboard's top rows plus any row a credential can actually use, each marked with who lists it.
 * Matching is by model identity (word order, dates and variant words ignored), as for the text rankings.
 */
export function buildMediaRanking(input: { rows: MediaRow[]; available: MediaModel[]; limit?: number }): MediaRanking {
  const limit = input.limit ?? 15;
  const sorted = [...input.rows].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.elo - a.elo || a.name.localeCompare(b.name));
  const keysFor = (row: MediaRow) => new Set([modelKey(row.slug), modelKey(row.name)].filter(Boolean));
  const matched = new Set<MediaModel>();
  const withModels = sorted.map((row) => {
    const keys = keysFor(row);
    const available = input.available.filter((m) => keys.has(modelKey(m.model)));
    available.forEach((m) => matched.add(m));
    return { row, available };
  });
  const rows = withModels
    .filter((entry, index) => index < limit || entry.available.length > 0)
    .map(({ row, available }) => ({
      rank: row.rank,
      name: row.name,
      creator: row.creator,
      elo: row.elo,
      ci95: row.ci95,
      appearances: row.appearances,
      releaseDate: row.releaseDate,
      available: available.map((m) => ({ profileLabel: m.profileLabel, model: m.model })),
    }));
  return {
    rows,
    unmatched: input.available.filter((m) => !matched.has(m)).map((m) => ({ profileLabel: m.profileLabel, model: m.model })),
    total: sorted.length,
  };
}
