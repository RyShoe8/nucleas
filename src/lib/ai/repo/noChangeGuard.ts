/**
 * A deterministic sanity check for "I found nothing / nothing needs changing" reports. Small models
 * search one folder, come back empty and tell the user they are mistaken. Before a Reviewer may accept
 * such a report, check whether the user's own key terms appear in files the report never mentions.
 */

const NO_CHANGE_CLAIMS: RegExp[] = [
  /\b(?:no|not)\b[^.\n]{0,60}\bfound\b/i,
  /\b(?:could not|couldn'?t|did not|didn'?t|unable to)\s+(?:find|locate|identify)\b/i,
  /\bno\s+(?:change|changes|modification|modifications|removal|action|edits?)\b[^.\n]{0,30}\b(?:needed|necessary|required)\b/i,
  /\balready\s+(?:removed|fixed|resolved|handled)\b/i,
  /\bdid(?:n'?t| not)\s+(?:reveal|show|contain|include|surface)\b/i,
  /\bno\s+(?:indication|evidence|sign|trace|record|mention)\b/i,
  /\bnot\s+(?:present|listed|defined|contained|mentioned)\b/i,
  /\bdoes(?:n'?t| not)\s+(?:exist|appear)\b/i,
];

export function claimsNothingFound(text: string): boolean {
  return NO_CHANGE_CLAIMS.some((pattern) => pattern.test(text));
}

/** Distinctive terms in the request: quoted text, CamelCase/digit identifiers and hyphenated names. */
export function keyTerms(userText: string): string[] {
  const terms = new Set<string>();
  for (const m of userText.matchAll(/["'“‘]([^"'”’\n]{3,60})["'”’]/g)) terms.add(m[1].trim());
  for (const m of userText.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
    const word = m[0];
    if (word.length >= 4 && (/[a-z][A-Z]|[A-Z]{2}|[0-9]/.test(word.slice(1)))) terms.add(word);
  }
  for (const m of userText.matchAll(/[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+/g)) if (m[0].length >= 5) terms.add(m[0]);
  return [...terms].slice(0, 12);
}

const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|build|\.next|coverage)\/|\.(?:lock|md|mdx|map|svg|png|jpe?g|gif|ico|woff2?)$|(?:package-lock|pnpm-lock)\.json$|\.min\.[a-z]+$/i;
const TEST_PATH = /(?:\.|\/)(?:test|spec)\.[a-z]+$|(?:^|\/)__tests__\//i;
const MAX_FILE_CHARS = 400_000;

export interface NoChangeCheck {
  terms: string[];
  /** Files that mention the request's terms but are not covered by the report. */
  unexplored: { path: string; matched: string[] }[];
  jobs: string[];
}

export function checkNoChangeClaim(input: { userText: string; workerText: string; files: Map<string, string> }): NoChangeCheck | null {
  if (!claimsNothingFound(input.workerText)) return null;
  const terms = keyTerms(input.userText);
  if (!terms.length) return null;
  const lowerTerms = terms.map((t) => t.toLowerCase());
  const need = Math.min(2, terms.length);
  const worker = input.workerText.toLowerCase();
  const scored: { path: string; matched: string[]; test: boolean }[] = [];
  for (const [path, content] of input.files) {
    if (SKIP_PATH.test(path) || content.length > MAX_FILE_CHARS) continue;
    const lower = content.toLowerCase();
    const matched = terms.filter((_, i) => lower.includes(lowerTerms[i]));
    if (matched.length < need) continue;
    const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    if (worker.includes(path.toLowerCase()) || (base.includes('.') && worker.includes(base))) continue;
    scored.push({ path, matched, test: TEST_PATH.test(path) });
  }
  const unexplored = scored
    .filter((item) => !item.test)
    .sort((a, b) => b.matched.length - a.matched.length || a.path.localeCompare(b.path))
    .slice(0, 5)
    .map(({ path, matched }) => ({ path, matched }));
  if (!unexplored.length) return null;
  return {
    terms,
    unexplored,
    jobs: [
      ...unexplored.map((item) => `Read ${item.path} (it mentions ${item.matched.join(', ')}) and explain how it relates to the user's report; the earlier report did not cover it.`),
      'The user is describing what they see in the product. Do not conclude that nothing needs changing until you can say where that is rendered (use repo_references from the data file up to the page).',
    ],
  };
}
