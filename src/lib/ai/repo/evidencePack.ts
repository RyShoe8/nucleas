/**
 * A deterministic evidence pack: facts about how the code connects, computed from the repository
 * before any model runs. Small models search for the keyword in a request and stop at the first file
 * that mentions it; this hands them what a careful engineer would establish first, with file:line
 * citations they can quote:
 *
 *  - the data path from the page a request names down to the files that mention the request's names,
 *    including the files in between, where lists and views are assembled;
 *  - the exact lines that mention those names;
 *  - places where the path reads from a database or external service, whose contents are not in the repo;
 *  - who else reads the files that are likely to change.
 */
import { displayedNames, identifierTerms, snapshotCandidates } from './digSelect';
import { contextAround, describeEntry } from './entryFacts';
import { connectingLine, findReferences, reachableFrom, routeFileFor, shortestPaths } from './references';

export interface PathHop {
  file: string;
  /** The line in the previous hop that leads here (the import, include or call). Absent for the first hop. */
  via?: { file: string; line: number; text: string };
}

export interface EvidencePack {
  page: { file: string; route: string } | null;
  terms: string[];
  /** Page first, target last; the files between are where the data is assembled. */
  chains: { target: string; hops: PathHop[] }[];
  /** Lines that mention the request's names, in the target files. */
  termLines: { file: string; line: number; text: string; term: string }[];
  /** Data the path reads that is not in the repository. */
  unverified: { file: string; line: number; text: string; note: string; /** The model or table read, when the code names it. */ model?: string }[];
  /** Other consumers of the target files: a change there reaches these too. */
  readers: { file: string; usedBy: string[]; routes: string[] }[];
  /** Every file the named page depends on (empty when the request names no page). */
  scope: Set<string>;
  /** Files worth reading first: targets, then the assemblers between the page and them. */
  focus: { file: string; line?: number }[];
  /** Files on the path that mention the names only as lowercase keys, never as displayed text: usually lookups, not the listing. */
  lookupOnly?: string[];
  /** Path files that hold the names as displayed (the likely definition of the listing). */
  displayFiles?: string[];
  /** What object each of the lines above belongs to, so the structure around them is not guessed. */
  entries?: { file: string; line: number; text: string; snippet: string }[];
  /** The pack as a block of text for a model. */
  text: string;
}

const DATA_STORE_READS: [RegExp, string][] = [
  [/\b[A-Z]\w*\.(?:find|findOne|findById|findMany|findAll|aggregate|countDocuments|distinct)\s*\(/, 'reads from a database'],
  [/\bprisma\.\w+\.(?:find\w*|create|update|upsert|delete\w*)\s*\(/, 'reads from a database'],
  [/\b(?:db|knex|sequelize|pool|client|conn|connection)\.(?:query|select|from|execute|raw)\s*\(/, 'reads from a database'],
  [/\bSELECT\b[\s\S]{0,60}\bFROM\b/, 'runs a SQL query'],
  [/\.objects\.(?:filter|all|get|exclude)\s*\(/, 'reads from a database (Django ORM)'],
  [/\$wpdb->|\bnew\s+WP_Query\b|\bget_posts\s*\(|\bget_option\s*\(/, 'reads WordPress content or options stored in the database'],
  [/\bfetch\(\s*['"`]https?:\/\/(?!localhost)/, 'calls an external service'],
];

const isTestFile = (p: string) => /(?:\.|\/)(?:test|spec)\.[a-z]+$|(?:^|\/)__tests__\//i.test(p);

/**
 * Where an assembler file actually uses what it takes from the next hop. The import line only says it is
 * imported; the first use of the imported name is where the list or view is built.
 */
export function usageLine(files: Map<string, string>, from: string, via: { line: number; text: string }): number {
  const names = new Set<string>();
  for (const m of via.text.matchAll(/\bimport\s+(?:type\s+)?(\w+)/g)) names.add(m[1]);
  for (const m of via.text.matchAll(/[{,]\s*(?:\w+\s+as\s+)?(\w+)\s*(?=[,}])/g)) names.add(m[1]);
  for (const m of via.text.matchAll(/\bimport\s+(\w[\w\s,]*)$/g)) m[1].split(',').forEach((n) => names.add(n.trim().split(/\s+as\s+/).pop()!));
  names.delete('import'); names.delete('from'); names.delete('type'); names.delete('default'); names.delete('');
  if (!names.size) return via.line;
  const lines = (files.get(from) ?? '').split('\n');
  const re = new RegExp(`(?<![\\w.$])(?:${[...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);
  for (let i = via.line; i < lines.length; i += 1) if (re.test(lines[i])) return i + 1;
  return via.line;
}

const clip = (text: string, max = 160) => text.trim().replace(/\s+/g, ' ').slice(0, max);

const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*|<!--|--\s|;)/;

/**
 * Lines that mention the names, chosen like a person would: real code before comments, and from the
 * densest cluster of mentions, not merely the first ones in the file.
 */
function termLinesIn(files: Map<string, string>, file: string, terms: string[], perFile = 4): EvidencePack['termLines'] {
  const lines = (files.get(file) ?? '').split('\n');
  const hits: { index: number; term: string; code: boolean }[] = [];
  for (let i = 0; i < lines.length && hits.length < 300; i += 1) {
    const lower = lines[i].toLowerCase();
    const term = terms.find((t) => lower.includes(t));
    if (term) hits.push({ index: i, term, code: !COMMENT_LINE.test(lines[i]) });
  }
  if (!hits.length) return [];
  // Comments only count when there is no real code line to quote.
  const pool = hits.some((h) => h.code) ? hits.filter((h) => h.code) : hits;
  const density = (center: number) => pool.filter((h) => Math.abs(h.index - center) <= 25).length;
  const centre = pool.reduce((best, h) => (density(h.index) > density(best.index) ? h : best), pool[0]).index;
  const ordered = [...pool].sort((a, b) => Math.abs(a.index - centre) - Math.abs(b.index - centre));
  return ordered.slice(0, perFile).sort((a, b) => a.index - b.index).map((h) => ({ file, line: h.index + 1, text: clip(lines[h.index]), term: h.term }));
}

const MODEL_NAMES: RegExp[] = [
  /\b([A-Z]\w*)\.(?:find|findOne|findById|findMany|findAll|aggregate|countDocuments|distinct)\s*\(/,
  /\bprisma\.(\w+)\./,
  /\b(\w+)\.objects\./,
];

/** Data the file reads that the repository cannot show: each distinct model or service once, so a later read is not hidden behind the first. */
function unverifiedIn(files: Map<string, string>, file: string): EvidencePack['unverified'] {
  const lines = (files.get(file) ?? '').split('\n');
  const out: EvidencePack['unverified'] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length && out.length < 6; i += 1) {
    for (const [re, note] of DATA_STORE_READS) {
      if (!re.test(lines[i])) continue;
      const model = MODEL_NAMES.map((m) => m.exec(lines[i])?.[1]).find(Boolean);
      const key = model ?? note;
      if (!seen.has(key)) { seen.add(key); out.push({ file, line: i + 1, text: clip(lines[i]), note, ...(model ? { model } : {}) }); }
      break;
    }
  }
  return out;
}

export function buildEvidencePack(files: Map<string, string>, userText: string, options: { maxTargets?: number } = {}): EvidencePack | null {
  const terms = identifierTerms(userText);
  const page = routeFileFor(files, userText);
  const scope = page ? new Set(reachableFrom(files, page.file)) : new Set<string>();

  // Targets: files (on the page's path when one is named) that mention the request's names.
  const idHits = (file: string) => terms.filter((t) => (files.get(file) ?? '').toLowerCase().includes(t)).length;
  // A listing on screen comes from code (or data) that holds the name as displayed. A file that has only the
  // lowercase key ("openhv": "openra-master") is a lookup, so files with the displayed spelling rank first.
  const shown = displayedNames(userText);
  const displayCount = (file: string) => {
    const content = files.get(file) ?? '';
    let n = 0;
    for (const word of shown) n += content.split(word).length - 1;
    return n;
  };
  const pool = scope.size ? [...scope] : snapshotCandidates({ files }, userText, 12);
  const targets = pool
    .filter((f) => !isTestFile(f) && !/\.(?:md|mdx)$/.test(f) && idHits(f) > 0)
    .sort((a, b) => idHits(b) - idHits(a) || Math.min(displayCount(b), 40) - Math.min(displayCount(a), 40) || a.localeCompare(b))
    .slice(0, options.maxTargets ?? 3);
  const displayFiles = shown.length ? pool.filter((f) => !isTestFile(f) && !/\.(?:md|mdx)$/.test(f) && displayCount(f) > 0).slice(0, 6) : [];
  const lookupOnly = pool.filter((f) => !isTestFile(f) && !/\.(?:md|mdx)$/.test(f) && idHits(f) > 0 && shown.length > 0 && displayCount(f) === 0).slice(0, 4);
  if (!page && !targets.length) return null;

  const chains: EvidencePack['chains'] = [];
  if (page && targets.length) {
    const found = shortestPaths(files, page.file, new Set(targets));
    for (const target of targets) {
      const chain = found.get(target);
      if (!chain) continue;
      chains.push({
        target,
        hops: chain.map((file, i) => {
          if (i === 0) return { file };
          const via = connectingLine(files, chain[i - 1], file);
          return { file, ...(via ? { via: { file: chain[i - 1], ...via } } : {}) };
        }),
      });
    }
  }

  const termLines = targets.flatMap((t) => termLinesIn(files, t, terms));
  const pathFiles = [...new Set(chains.flatMap((c) => c.hops.map((h) => h.file)))].filter((f) => f !== page?.file);
  const unverified = pathFiles.flatMap((f) => unverifiedIn(files, f)).slice(0, 10);
  const readers = targets.slice(0, 3).flatMap((file) => {
    const refs = findReferences(files, file, { maxDepth: 3, limit: 80 });
    if ('error' in refs) return [];
    // Only *other* consumers: files the named page already uses are on the path, not side effects.
    const others = refs.references.filter((r) => !isTestFile(r.path) && !scope.has(r.path) && r.path !== page?.file);
    const direct = others.filter((r) => r.depth === 1).map((r) => r.path);
    // Routes served by files outside the page's own path.
    const routes = [...new Set(others.map((r) => r.route).filter((r): r is string => Boolean(r)))];
    return [{ file, usedBy: direct.slice(0, 6), routes: routes.slice(0, 8) }];
  });

  // What to read first: the data files, then the files between them and the page (nearest the data first).
  const focus: EvidencePack['focus'] = [];
  const add = (file: string, line?: number) => { if (!focus.some((f) => f.file === file)) focus.push({ file, ...(line ? { line } : {}) }); };
  for (const t of targets) add(t, termLines.find((l) => l.file === t)?.line);
  for (const chain of chains) {
    for (let i = chain.hops.length - 2; i >= 1; i -= 1) {
      // Centre an assembler on where it uses what the next hop provides.
      const next = chain.hops[i + 1].via;
      add(chain.hops[i].file, next ? usageLine(files, chain.hops[i].file, next) : undefined);
    }
  }

  const entries: NonNullable<EvidencePack['entries']> = [];
  for (const l of termLines) {
    if (entries.length >= 3) break;
    const content = files.get(l.file);
    const text = content ? describeEntry(l.file, l.line, content) : null;
    if (content && text && !entries.some((e) => e.text === text)) entries.push({ file: l.file, line: l.line, text, snippet: contextAround(content, l.line, 4) });
  }
  const pack: EvidencePack = { page, terms, chains, termLines, unverified, readers, scope, focus, entries, lookupOnly, displayFiles, text: '' };
  pack.text = renderEvidencePack(pack);
  return pack;
}

export function renderEvidencePack(pack: Omit<EvidencePack, 'text'> | EvidencePack): string {
  const out: string[] = ['Evidence traced from the repository (facts computed from the code; cite these file:line references):'];
  if (pack.page) out.push(`The request names the page ${pack.page.route}, served by ${pack.page.file}.`);
  for (const chain of pack.chains) {
    out.push(`Data path to ${chain.target}:`);
    chain.hops.forEach((hop, i) => {
      out.push(i === 0 || !hop.via
        ? `  ${i + 1}. ${hop.file}`
        : `  ${i + 1}. ${hop.file}  (reached from ${hop.via.file}:${hop.via.line} \`${hop.via.text}\`)`);
    });
    if (chain.hops.length > 2) out.push('  The files between the page and the data are where the list or view is assembled; read them before proposing a change.');
  }
  if (pack.termLines.length) {
    out.push(`Lines mentioning ${pack.terms.join(', ')}:`);
    for (const l of pack.termLines) out.push(`  ${l.file}:${l.line}: \`${l.text}\``);
  }
  if (pack.lookupOnly?.length) {
    out.push(`These files mention the names only as lowercase keys, never as the text a person sees: ${pack.lookupOnly.join(', ')}. They are usually lookups (how to query, group or route something), not where a listing is defined; do not change one unless you show that the listing is built from it.`);
  }
  if (pack.entries?.length) {
    out.push('Structure around those lines (computed from the brackets in the file; do not assume any structure that is not shown here):');
    for (const e of pack.entries) out.push(`  ${e.text}`, ...e.snippet.split('\n').map((l) => `    ${l}`));
  }
  for (const r of pack.readers) {
    if (r.usedBy.length || r.routes.length) out.push(`${r.file} is also used by: ${[...r.usedBy, ...r.routes.map((x) => `route ${x}`)].join(', ')}. A change there reaches them too.`);
  }
  for (const u of pack.unverified) out.push(`Not verifiable from the repository: ${u.file}:${u.line} ${u.note} (\`${u.text}\`), so the stored data may differ from what the code files show.`);
  return out.join('\n');
}
