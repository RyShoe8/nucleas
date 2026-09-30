/**
 * What a live page shows, reduced to the parts that bear on the request. The full page of an admin area
 * can hold customer data; only the lines around the request's own names (with a little context) are kept,
 * which is also all a planner needs to see "OpenHV listed twice, under these headings".
 */

export interface ObservedPage {
  url: string;
  title: string | null;
  /** Lines around each mention of the request's names, in page order, with "…" between gaps. */
  windows: string;
  /** How many lines mention the names. */
  matches: number;
  /** The names that never appear on the page. */
  missing: string[];
}

export function observedWindows(pageText: string, terms: string[], options: { radius?: number; maxChars?: number } = {}): { windows: string; matches: number; missing: string[] } {
  const radius = options.radius ?? 3;
  // Personal data is masked even inside the windows: the models and the saved plan never need it.
  const lines = pageText.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]').replace(/\d[\d -]{10,}\d/g, '[number]').trim());
  const wanted = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 3))];
  const hit = new Set<number>();
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const t of wanted) if (lower.includes(t)) { hit.add(i); seen.add(t); }
  });
  const keep = new Set<number>();
  for (const i of hit) for (let j = Math.max(0, i - radius); j <= Math.min(lines.length - 1, i + radius); j += 1) keep.add(j);
  const out: string[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (!lines[i]) continue;
    if (i !== last + 1 && out.length) out.push('…');
    out.push(`${hit.has(i) ? '> ' : '  '}${lines[i].slice(0, 200)}`);
    last = i;
  }
  const windows = out.join('\n').slice(0, options.maxChars ?? 3000);
  return { windows, matches: hit.size, missing: wanted.filter((t) => !seen.has(t)) };
}

export function renderObservedPage(page: ObservedPage): string {
  return [
    `What the page shows right now (opened read-only at ${page.url} with the company's admin account${page.title ? `; title "${page.title}"` : ''}). Lines mentioning the request's names are marked >; headings and neighbouring rows are shown for context.`,
    page.matches ? page.windows : `No line on the page mentions ${page.missing.join(', ') || 'the request’s names'}.`,
    ...(page.matches && page.missing.length ? [`Not on the page at all: ${page.missing.join(', ')}.`] : []),
    'This is what visitors of the deployed site see today; it can differ from the repository if the site was not redeployed. Rows that come from a database appear here even though no code file lists them.',
  ].join('\n');
}
