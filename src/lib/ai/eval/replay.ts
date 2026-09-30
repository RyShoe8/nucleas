/**
 * Replay evaluation: measure how well the pipeline finds the right code by replaying a repository's own
 * history. Each past commit is a task: its message is the request, the files it changed are the answer.
 * The score does not depend on any site or framework, so it works on every repository we build for, and
 * turns "did this change help?" into a number instead of an anecdote.
 *
 * Two layers are measured. Retrieval (does the dig show the right files first?) needs no model and runs in
 * seconds. Planning (do the plan's files match the answer?) scores plans from real model runs.
 */

export interface CommitRecord {
  sha: string;
  subject: string;
  body: string;
  files: string[];
}

export interface ReplayCase {
  id: string;
  request: string;
  /** Files the commit changed that still exist and are source code: what a good plan must touch. */
  truth: string[];
}

const NON_SOURCE = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum)$|\.(?:md|mdx|txt|svg|png|jpe?g|gif|ico|woff2?|lock|map|snap)$|(?:^|\/)(?:docs?|\.github|\.claude)\//i;
const TEST_FILE = /(?:\.|\/)(?:test|spec)\.[a-z]+$|(?:^|\/)__tests__\//i;

export function isSourceFile(path: string): boolean {
  return !NON_SOURCE.test(path) && !TEST_FILE.test(path);
}

const NOISE_SUBJECT = /^(?:merge\b|revert\b|bump\b|chore\b|release\b|wip\b|update (?:dependencies|deps|lockfile)|initial commit)/i;

/**
 * Turns commits into tasks. Keeps commits that read like a request for one focused change: a real sentence,
 * a handful of files, at least one source file that still exists.
 */
export function mineCases(commits: CommitRecord[], existingFiles: Set<string>, options: { maxFiles?: number } = {}): ReplayCase[] {
  const cases: ReplayCase[] = [];
  const maxFiles = options.maxFiles ?? 8;
  for (const c of commits) {
    if (NOISE_SUBJECT.test(c.subject.trim()) || c.subject.trim().length < 15) continue;
    const changed = c.files.filter(Boolean);
    if (changed.length === 0 || changed.length > maxFiles) continue;
    const truth = changed.filter((f) => isSourceFile(f) && existingFiles.has(f));
    if (!truth.length) continue;
    const body = c.body.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').slice(0, 300) ?? '';
    cases.push({ id: c.sha.slice(0, 8), request: body ? `${c.subject.trim()}. ${body}` : c.subject.trim(), truth });
  }
  return cases;
}

/** Removes file names and paths from a request, so it cannot be answered by matching names in the message. */
export function maskPaths(request: string): string {
  return request
    .replace(/(?:[\w@.~-]+\/)+[\w@.~-]+\.[A-Za-z0-9]{1,6}\b/g, 'the file')
    .replace(/\b[\w@~-]+\.(?:[cm]?[jt]sx?|py|php|go|rb|rs|java|kt|vue|svelte|astro|liquid|html?|css|json|ya?ml)\b/g, 'the file');
}

export interface RetrievalScore {
  /** Share of the answer files that are among the first k shown. */
  recall: number;
  /** At least one answer file is among the first k. */
  hit: boolean;
  /** 1-based rank of the first answer file, or 0 when none is shown. */
  firstRank: number;
}

export function scoreRetrieval(shown: string[], truth: string[], k: number): RetrievalScore {
  const top = shown.slice(0, k);
  const found = truth.filter((t) => top.includes(t));
  const ranks = truth.map((t) => top.indexOf(t)).filter((i) => i >= 0);
  return { recall: truth.length ? found.length / truth.length : 0, hit: found.length > 0, firstRank: ranks.length ? Math.min(...ranks) + 1 : 0 };
}

export interface PlanScore { precision: number; recall: number; f1: number }

/** How well the files a plan will change match the files the real change touched. */
export function scorePlanTargets(planFiles: string[], truth: string[]): PlanScore {
  const planned = planFiles.filter(isSourceFile);
  const hit = planned.filter((f) => truth.includes(f)).length;
  const precision = planned.length ? hit / planned.length : 0;
  const recall = truth.length ? truth.filter((t) => planned.includes(t)).length / truth.length : 0;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

export interface MethodSummary { cases: number; hitRate: number; meanRecall: number; meanFirstRank: number }

export function summarize(scores: RetrievalScore[]): MethodSummary {
  const n = scores.length || 1;
  const ranked = scores.filter((s) => s.firstRank > 0);
  return {
    cases: scores.length,
    hitRate: scores.filter((s) => s.hit).length / n,
    meanRecall: scores.reduce((sum, s) => sum + s.recall, 0) / n,
    meanFirstRank: ranked.length ? ranked.reduce((sum, s) => sum + s.firstRank, 0) / ranked.length : 0,
  };
}

/**
 * The keyword ranking the dig used before it traced code: path words and content words, weighted equally
 * however common they are. Kept as the baseline so an improvement is measured, not remembered.
 */
export function keywordBaseline(files: Map<string, string>, request: string, limit: number): string[] {
  const stop = new Set(['about', 'after', 'also', 'been', 'before', 'could', 'does', 'from', 'have', 'into', 'listed', 'listing', 'make', 'need', 'only', 'page', 'remove', 'should', 'that', 'their', 'there', 'these', 'thing', 'this', 'under', 'want', 'what', 'when', 'where', 'which', 'with', 'would']);
  const tokens = [...new Set((request.match(/[A-Za-z0-9_-]{4,}/g) ?? []).map((t) => t.toLowerCase()))].filter((t) => !stop.has(t)).slice(0, 16);
  if (!tokens.length) return [];
  const scored: { path: string; score: number }[] = [];
  for (const [path, content] of files) {
    const pathLower = path.toLowerCase();
    const contentLower = content.toLowerCase();
    let score = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|json|ya?ml)$/i.test(path) ? 2 : 0;
    let hits = 0;
    for (const token of tokens) {
      if (pathLower.includes(token)) { score += 12; hits += 1; }
      if (contentLower.includes(token)) { score += 4; hits += 1; }
    }
    if (hits) scored.push({ path, score: score + hits * hits });
  }
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit).map((r) => r.path);
}
