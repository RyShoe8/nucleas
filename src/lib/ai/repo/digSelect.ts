/**
 * Deterministic file selection for the repository dig: which files to show a model before it calls any
 * tool, and which part of each. Pure (no server imports) so it can be tested and measured on any checkout.
 */

const QUERY_STOP_WORDS = new Set([
  'about', 'after', 'also', 'been', 'before', 'could', 'does', 'from', 'have', 'into', 'listed',
  'listing', 'make', 'need', 'only', 'page', 'remove', 'should', 'that', 'their', 'there', 'these',
  'thing', 'this', 'under', 'want', 'what', 'when', 'where', 'which', 'with', 'would',
]);

export function queryTokens(query: string): string[] {
  return [...new Set((query.match(/[A-Za-z0-9_-]{4,}/g) ?? []).map(token => token.toLowerCase()))]
    .filter(token => !QUERY_STOP_WORDS.has(token))
    .slice(0, 16);
}

/**
 * Distinctive names in the request (OpenHV, ConnectManager, E2140): mixed-case or digit-bearing words.
 * They identify the thing being asked about far better than the URL or ordinary words around them.
 */
export function identifierTerms(query: string): string[] {
  const terms = (query.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => word.length >= 4 && /[a-z][A-Z]|[A-Z]{2}|[0-9]/.test(word.slice(1)));
  return [...new Set(terms.map((t) => t.toLowerCase()))].slice(0, 8);
}

/** The distinctive names as the user wrote them (OpenHV, ConnectManager): the spelling people see on screen, not the lowercase key a program looks up. */
export function displayedNames(query: string): string[] {
  const words = (query.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => word.length >= 4 && /[a-z][A-Z]|[A-Z]{2}|[0-9]/.test(word.slice(1)));
  return [...new Set(words)].slice(0, 8);
}

const TEST_FILE = /(?:\.|\/)(?:test|spec)\.[a-z]+$|(?:^|\/)__tests__\//i;
const DOC_FILE = /(?:^|\/)docs?\/|\.mdx?$/i;

/**
 * Whole-repository candidate selection that makes no assumptions about src/platform/app layout.
 * Files that contain several of the request's distinctive names together rank first: that is where a
 * "X is also listed under Y" bug lives, while path words like "admin" or "connect" match half the app.
 */
export function snapshotCandidates(snapshot: { files: Map<string, string> }, query: string, limit = 20, options: { scope?: Set<string> } = {}): string[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const ids = identifierTerms(query);
  const scored: { path: string; score: number }[] = [];
  for (const [path, content] of snapshot.files) {
    const pathLower = path.toLowerCase();
    const contentLower = content.toLowerCase();
    let score = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|json|ya?ml)$/i.test(path) ? 2 : 0;
    let hits = 0;
    for (const token of tokens) {
      if (pathLower.includes(token)) { score += 12; hits += 1; }
      if (contentLower.includes(token)) { score += 4; hits += 1; }
    }
    const idHits = ids.filter((id) => contentLower.includes(id)).length;
    if (idHits) score += idHits * 25 + (idHits >= 2 ? 60 : 0);
    // A file the named page actually uses (imports, API calls) beats one that merely shares the words.
    if (options.scope?.has(path)) score += idHits ? 80 : 15;
    // Tests and docs describe behaviour but are rarely where it is defined.
    if (TEST_FILE.test(path)) score -= 25;
    else if (DOC_FILE.test(path)) score -= 30;
    if (hits || idHits) scored.push({ path, score: score + hits * hits });
  }
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit).map(row => row.path);
}

/** Center an excerpt on the densest cluster of query terms, not merely the first incidental hit. */
export function relevantExcerptStart(content: string, query: string, excerptChars: number): number {
  const lower = content.toLowerCase();
  const positions: number[] = [];
  for (const token of queryTokens(query)) {
    let from = 0;
    for (let count = 0; count < 12; count += 1) {
      const position = lower.indexOf(token, from);
      if (position < 0) break;
      positions.push(position);
      from = position + token.length;
    }
  }
  if (!positions.length) return 0;
  const radius = Math.max(400, Math.floor(excerptChars / 2));
  const center = positions.reduce((best, candidate) => {
    const density = positions.filter((position) => Math.abs(position - candidate) <= radius).length;
    const bestDensity = positions.filter((position) => Math.abs(position - best) <= radius).length;
    return density > bestDensity ? candidate : best;
  }, positions[0]!);
  return Math.max(0, center - Math.floor(excerptChars / 2));
}


