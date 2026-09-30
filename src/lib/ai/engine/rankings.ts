import type { AvailableModel } from './catalog';
import { matchBenchmark, type BenchmarkRow, type ModelBenchmark } from './benchmarks';
import { checkScore, type Need } from './select';

/**
 * The AI Engine window's ranking tables. Paid models are ranked by Artificial Analysis scores; local
 * (free) models are added beside them. A local model gets its Artificial Analysis score when it is on
 * their leaderboard, and always shows Nucleas's own check score. The two are different scales, so they
 * are separate columns and never blended into one number.
 */

export type RankingNeed = Extract<Need, 'plan' | 'code'>;

export interface RankingRow {
  profileLabel: string;
  model: string;
  /** Blended $ per 1M tokens; null for local models. */
  price: number | null;
  free: boolean;
  /** Artificial Analysis scores, when the model is on their leaderboard. */
  benchmark: ModelBenchmark | null;
  /** Nucleas check score for this kind of work (0–1); null until measured. Local models only. */
  check: number | null;
}

const rowScore = (row: RankingRow, need: RankingNeed): number | null =>
  row.benchmark ? (need === 'code' ? (row.benchmark.coding ?? row.benchmark.intelligence) : row.benchmark.intelligence) : null;

export function buildRanking(input: {
  paid: AvailableModel[];
  local: AvailableModel[];
  scores: BenchmarkRow[];
  need: RankingNeed;
  paidLimit?: number;
}): RankingRow[] {
  const paidRows: RankingRow[] = input.paid.slice(0, input.paidLimit ?? 12).map((m) => ({
    profileLabel: m.profileLabel, model: m.model, price: m.blendedPricePer1M, free: false, benchmark: m.benchmark, check: null,
  }));
  const localRows: RankingRow[] = input.local.map((m) => ({
    profileLabel: m.profileLabel, model: m.model, price: null, free: true,
    // Free models are never scored at load time; look them up here so open-weights models that
    // Artificial Analysis lists can be compared with the paid ones.
    benchmark: m.benchmark ?? matchBenchmark(m.model, input.scores),
    check: checkScore(m, input.need),
  }));
  const all = [...paidRows, ...localRows];
  // Scored rows first (highest first; paid before local on a tie), then unscored local models by check score.
  const scored = all.filter((r) => rowScore(r, input.need) !== null)
    .sort((a, b) => rowScore(b, input.need)! - rowScore(a, input.need)! || Number(a.free) - Number(b.free) || a.model.localeCompare(b.model));
  const unscored = all.filter((r) => rowScore(r, input.need) === null)
    .sort((a, b) => (b.check ?? -1) - (a.check ?? -1) || Number(a.free) - Number(b.free) || a.model.localeCompare(b.model));
  return [...scored, ...unscored];
}
