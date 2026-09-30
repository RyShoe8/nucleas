/**
 * Checks a plan's claims against the repository instead of trusting them. A model can write a confident
 * sentence about code it never read; it cannot make a quote appear in a file. Every quoted line is looked
 * up, planned edits are compared with the code the named page actually uses, and the other readers of the
 * files to be changed are listed, all deterministically.
 */
import type { PlanEvidence, StructuredPlan } from '@/lib/ide/planStructure';
import { plannedFiles } from '@/lib/ide/planStructure';
import { contextAround, describeEntry } from './entryFacts';
import { findReferences } from './references';

export { contextAround };

export interface ClaimCheck {
  /**
   * Quotes found in the cited file. `actualLine` is the nearest occurrence when the cited line was off.
   * `occurrences` is how many times the quote appears; `ambiguous` means it appears in several places and
   * the cited line does not single one out, so it proves little on its own.
   */
  verified: { evidence: PlanEvidence; actualLine?: number; /** The line the quote was found on (the cited line when it was right). */ foundLine: number; occurrences: number; ambiguous: boolean }[];
  unverified: { evidence: PlanEvidence; reason: 'file_missing' | 'quote_not_found' }[];
  /** Path hops that name a file that is not in the repository. */
  missingPathFiles: string[];
  /** Files the plan edits that exist but are not used by the page the request names. */
  offPath: string[];
  /** Files the plan edits that do not exist (new files, or a wrong path). */
  newOrUnknown: string[];
  /** The plan quotes evidence, but none of it is in a file the named page uses. */
  evidenceOffPath: boolean;
  /** Issues as instructions to fix, for sending back to the planner. Empty when the plan checks out. */
  issues: string[];
}

const isTestOrDoc = (p: string) => /(?:\.|\/)(?:test|spec)\.[a-z]+$|(?:^|\/)__tests__\/|(?:^|\/)docs?\/|\.mdx?$/i.test(p);

/** Whitespace-insensitive, quote-style-insensitive form of code for comparing a quote with a file. */
const squash = (text: string) => text.replace(/[`'"“”‘’]/g, "'").replace(/\s+/g, ' ').trim();

function quoteFragments(quote: string): string[] {
  // A model may elide the middle of a line with "..." or "…"; every fragment must still appear.
  return quote.split(/\.{3}|…/).map(squash).filter((f) => f.length >= 6);
}

/**
 * Every line (1-based) where the fragment starts, ignoring whitespace and quote style, and matching across
 * line breaks so a multi-line quote works. Empty when it does not appear.
 */
function occurrencesOf(content: string, fragment: string): number[] {
  const tokens = fragment.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const pattern = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['"`\u2018\u2019\u201C\u201D]/g, `['"\`\u2018\u2019\u201C\u201D]`))
    .join('\\s+');
  const lines: number[] = [];
  for (const m of content.matchAll(new RegExp(pattern, 'g'))) {
    lines.push(1 + (content.slice(0, m.index).match(/\n/g)?.length ?? 0));
    if (lines.length >= 200) break;
  }
  return lines;
}

export function checkPlanClaims(
  files: Map<string, string>,
  plan: { steps: string[]; structured?: StructuredPlan },
  options: { scope?: Set<string>; pageFile?: string } = {}
): ClaimCheck {
  const s = plan.structured;
  const verified: ClaimCheck['verified'] = [];
  const unverified: ClaimCheck['unverified'] = [];
  for (const evidence of s?.rootCause?.evidence ?? []) {
    const content = files.get(evidence.file);
    if (content === undefined) { unverified.push({ evidence, reason: 'file_missing' }); continue; }
    const fragments = quoteFragments(evidence.quote);
    const found = fragments.map((f) => occurrencesOf(content, f));
    if (!fragments.length || found.some((lines) => lines.length === 0)) { unverified.push({ evidence, reason: 'quote_not_found' }); continue; }
    // A quote may appear in many places (gameSlug: "x" on several entries). The cited line picks the one meant.
    const lines = found[0];
    const nearest = evidence.line ? lines.reduce((best, l) => (Math.abs(l - evidence.line!) < Math.abs(best - evidence.line!) ? l : best), lines[0]) : lines[0];
    const cited = Boolean(evidence.line) && Math.abs(nearest - evidence.line!) <= 1;
    verified.push({
      evidence,
      foundLine: nearest,
      occurrences: lines.length,
      ambiguous: lines.length > 1 && !cited,
      ...(evidence.line && !cited ? { actualLine: nearest } : {}),
    });
  }

  const missingPathFiles = (s?.path ?? []).map((h) => h.file).filter((f) => !files.has(f));
  const planned = plannedFiles(plan);
  const scope = options.scope;
  const known = (f: string) => files.has(f);
  const offPath = scope?.size
    ? planned.filter((f) => known(f) && !isTestOrDoc(f) && !scope.has(f) && f !== options.pageFile)
    : [];
  const newOrUnknown = planned.filter((f) => !known(f));
  const evidenceOffPath = Boolean(scope?.size) && verified.length > 0 && verified.every((v) => !scope!.has(v.evidence.file) && v.evidence.file !== options.pageFile);

  const issues: string[] = [];
  for (const u of unverified) {
    issues.push(u.reason === 'file_missing'
      ? `rootCause.evidence: ${u.evidence.file} does not exist in the repository. Cite a real file.`
      : `rootCause.evidence: the quote \`${u.evidence.quote.slice(0, 80)}\` was not found in ${u.evidence.file}. Copy the line exactly as it appears, or remove the claim.`);
  }
  for (const v of verified) {
    if (v.ambiguous && v.occurrences >= 3) {
      issues.push(`rootCause.evidence: \`${v.evidence.quote.slice(0, 60)}\` appears ${v.occurrences} times in ${v.evidence.file}, so it does not show which entry you mean. Give the exact line number, or quote two lines that include one only this entry has.`);
    }
  }
  if (missingPathFiles.length) issues.push(`path: ${missingPathFiles.slice(0, 4).join(', ')} not found in the repository. List only files that exist.`);
  if (evidenceOffPath) issues.push('rootCause.evidence: none of the quoted code is in a file the named page uses. Trace how the page gets its data and quote the code on that path.');
  if (offPath.length) issues.push(`filesToChange: ${offPath.slice(0, 4).join(', ')} is not used by the page the request names, so editing it would not change what the page shows. Edit code on the page's data path, or explain what else reads it.`);
  return { verified, unverified, missingPathFiles, offPath, newOrUnknown, evidenceOffPath, issues };
}

/** The code around each quoted line that was found, for the planner to reread, the Worker and Critic to check, and the reviewer to see. */
export function quoteContexts(files: Map<string, string>, check: Pick<ClaimCheck, 'verified'>, max = 4, radius = 5): { file: string; line: number; snippet: string; entry?: string }[] {
  const seen = new Set<string>();
  const out: { file: string; line: number; snippet: string; entry?: string }[] = [];
  for (const v of check.verified) {
    const key = `${v.evidence.file}:${v.foundLine}`;
    const content = files.get(v.evidence.file);
    if (!content || seen.has(key)) continue;
    seen.add(key);
    out.push({ file: v.evidence.file, line: v.foundLine, snippet: contextAround(content, v.foundLine, radius), ...(describeEntry(v.evidence.file, v.foundLine, content) ? { entry: describeEntry(v.evidence.file, v.foundLine, content)! } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

export function renderQuoteContexts(contexts: { file: string; line: number; snippet: string; entry?: string }[]): string {
  return contexts.map((c) => `${c.file}:${c.line}\n${c.snippet}${c.entry ? `\n${c.entry}` : ''}`).join('\n\n');
}

const SENTENCE_SPLIT = /\n+|;\s+|\.\s+(?=[A-Z])/;
const FILE_LINE = /((?:[\w@.~-]+\/)*[\w@.~-]+\.[A-Za-z0-9]{1,6}):(\d{1,6})\b/g;
const QUOTED = /'([^'\n]{3,60})'|"([^"\n]{3,60})"|`([^`\n]{3,60})`/g;
const looksLikePath = (t: string) => /\/|\.[a-z]{1,5}$/i.test(t);

function quotedTokens(text: string): string[] {
  return [...text.matchAll(QUOTED)].map((m) => (m[1] ?? m[2] ?? m[3]).trim()).filter((t) => t && !looksLikePath(t));
}

function planSentences(plan: { steps: string[]; structured?: StructuredPlan }): { where: string; text: string }[] {
  const s = plan.structured;
  const out: { where: string; text: string }[] = [];
  plan.steps.forEach((step, i) => step.split(SENTENCE_SPLIT).forEach((text) => out.push({ where: `step ${i + 1}`, text })));
  for (const [where, text] of [['walkthrough', s?.walkthrough], ['expectedResult', s?.expectedResult], ['rootCause', s?.rootCause?.explanation]] as const) {
    if (text) text.split(SENTENCE_SPLIT).forEach((t) => out.push({ where, text: t }));
  }
  return out.filter((x) => x.text.trim());
}

/** The one file the plan is about, when it names just one to change. */
const soleFile = (plan: { structured?: StructuredPlan }, files: Map<string, string>) => {
  const list = (plan.structured?.filesToChange ?? []).filter((f) => files.has(f));
  return list.length === 1 ? list[0] : undefined;
};

/**
 * Lines the plan cites for a named thing that do not show it. A plan that says "line 4414 contains the
 * 'openra' entry" is checked: 'openra' must be near line 4414 of that file.
 */
export function checkLineClaims(files: Map<string, string>, plan: { steps: string[]; structured?: StructuredPlan }): string[] {
  const issues: string[] = [];
  const only = soleFile(plan, files);
  const check = (where: string, file: string | undefined, line: number, text: string) => {
    const content = file ? files.get(file) : undefined;
    const tokens = quotedTokens(text);
    if (!content || !tokens.length) return;
    const lines = content.split('\n');
    const window = lines.slice(Math.max(0, line - 4), line + 3).join('\n').toLowerCase();
    if (tokens.some((t) => window.includes(t.toLowerCase()))) return;
    issues.push(`${where}: it says ${file}:${line} is about ${tokens.slice(0, 2).map((t) => `'${t}'`).join(' / ')}, but line ${line} is \`${(lines[line - 1] ?? '').trim().slice(0, 80)}\`. Reread the file and correct the line number or the claim.`);
  };
  for (const { where, text } of planSentences(plan)) {
    for (const m of text.matchAll(FILE_LINE)) check(where, m[1], Number(m[2]), text);
    for (const m of text.matchAll(/\blines?\s+(\d{1,6})\b/gi)) check(where, only, Number(m[1]), text);
  }
  for (const hop of plan.structured?.path ?? []) if (hop.line && hop.note) check('path', hop.file, hop.line, hop.note);
  return issues.slice(0, 4);
}

const KEEP = /\b(?:unchanged|untouched|remains?|stays?|left as[- ]is|not (?:be )?(?:changed|modified|touched|removed|deleted)|do not (?:change|modify|touch|remove|delete)|must not)\b/i;
const CHANGE = /\b(?:remove|delete|drop|replace|change|edit|rename|move|update)\b/i;

/** A step that changes the code another step says must stay as it is (same line, or the named thing sits on that line). */
export function findContradictions(files: Map<string, string>, plan: { steps: string[]; structured?: StructuredPlan }): string[] {
  const only = soleFile(plan, files);
  const sentences = planSentences(plan).filter((x) => x.where.startsWith('step') || x.where === 'walkthrough');
  const issues: string[] = [];
  const keepers = sentences.filter((x) => KEEP.test(x.text));
  const changers = sentences.filter((x) => !KEEP.test(x.text) && CHANGE.test(x.text));
  for (const keep of keepers) {
    const refs: { file?: string; line: number }[] = [
      ...[...keep.text.matchAll(FILE_LINE)].map((m) => ({ file: m[1], line: Number(m[2]) })),
      ...[...keep.text.matchAll(/\blines?\s+(\d{1,6})\b/gi)].map((m) => ({ file: only, line: Number(m[1]) })),
    ];
    for (const ref of refs) {
      const content = ref.file ? files.get(ref.file) : undefined;
      if (!content) continue;
      const window = content.split('\n').slice(Math.max(0, ref.line - 3), ref.line + 2).join('\n').toLowerCase();
      for (const change of changers) {
        if (change.where === keep.where && change.text === keep.text) continue;
        const hit = quotedTokens(change.text).find((t) => window.includes(t.toLowerCase()));
        const sameLine = [...change.text.matchAll(FILE_LINE)].some((m) => m[1] === ref.file && Math.abs(Number(m[2]) - ref.line) <= 1);
        if (hit || sameLine) {
          issues.push(`Contradiction: ${change.where} changes '${hit ?? `${ref.file}:${ref.line}`}', but ${keep.where} says the code at ${ref.file}:${ref.line} stays unchanged, and '${hit ?? 'it'}' is at that line. Decide which is meant and make the steps agree.`);
          break;
        }
      }
    }
  }
  return [...new Set(issues)].slice(0, 3);
}

/** The database models the code path reads that the plan never mentions: stored rows could keep the symptom alive. */
export function dataStoreIssues(reads: { file: string; line: number; model?: string; note: string }[], plan: { structured?: StructuredPlan }): string[] {
  const s = plan.structured;
  const text = [...(s?.unverified ?? []), ...(s?.sideEffects ?? []), s?.rootCause?.explanation ?? '', s?.expectedResult ?? '', s?.walkthrough ?? ''].join('\n').toLowerCase();
  const missing = [...new Map(reads.filter((r) => r.model && /database/.test(r.note)).map((r) => [r.model!, r])).values()].filter((r) => !text.includes(r.model!.toLowerCase()));
  if (!missing.length) return [];
  return [`unverified: the code path reads ${missing.slice(0, 4).map((r) => `${r.model} (${r.file}:${r.line})`).join(', ')} from a database. For each, say whether stored rows could keep the symptom alive after your change, and how to check.`];
}

/** "None found" and similar cannot stand next to readers that were never assessed. */
export function withoutNoneClaims(sideEffects: string[]): string[] {
  return sideEffects.filter((x) => !/^\W*(?:none|nothing|no (?:other |further )?(?:side effects?|readers?|impact|effects?))\b/i.test(x));
}

/** Other consumers of the files a plan changes: a change there reaches them too. Excludes the page's own path. */
export function readersOfPlannedFiles(files: Map<string, string>, planned: string[], options: { scope?: Set<string>; pageFile?: string; pageRoute?: string } = {}): { file: string; usedBy: string[]; routes: string[] }[] {
  const out: { file: string; usedBy: string[]; routes: string[] }[] = [];
  for (const file of planned.filter((f) => files.has(f)).slice(0, 6)) {
    const refs = findReferences(files, file, { maxDepth: 3, limit: 80 });
    if ('error' in refs) continue;
    const others = refs.references.filter((r) => !isTestOrDoc(r.path) && !options.scope?.has(r.path) && r.path !== options.pageFile);
    const routes = [...new Set(others.map((r) => r.route).filter((r): r is string => Boolean(r) && r !== options.pageRoute))];
    const usedBy = others.filter((r) => r.depth === 1).map((r) => r.path);
    if (usedBy.length || routes.length) out.push({ file, usedBy: usedBy.slice(0, 6), routes: routes.slice(0, 8) });
  }
  return out;
}

export interface ReaderGroup {
  /** The folder (or route prefix) these readers share. */
  label: string;
  files: string[];
  routes: string[];
}

/** A route's prefix for grouping: up to three real segments, skipping :params (/admin/games/:slug/editions → /admin/games/editions). */
function routePrefix(route: string): string {
  return `/${route.split('/').filter((seg) => seg && !seg.startsWith(':')).slice(0, 3).join('/')}`;
}

/** Readers grouped by folder (and routes by prefix), so a plan can answer for many readers in one line. */
export function groupReaders(readers: ReturnType<typeof readersOfPlannedFiles>): ReaderGroup[] {
  const groups = new Map<string, ReaderGroup>();
  const group = (label: string) => groups.get(label) ?? groups.set(label, { label, files: [], routes: [] }).get(label)!;
  for (const r of readers) {
    for (const file of r.usedBy) group(file.split('/').slice(0, -1).slice(0, 4).join('/') || '(root)').files.push(file);
    for (const route of r.routes) group(`route ${routePrefix(route)}`).routes.push(route);
  }
  for (const g of groups.values()) { g.files = [...new Set(g.files)]; g.routes = [...new Set(g.routes)]; }
  return [...groups.values()].filter((g) => g.files.length || g.routes.length).slice(0, 8);
}

/** Text a plan uses to answer for its readers: the side-effects list. */
function sideEffectText(plan: { structured?: StructuredPlan }): string {
  return (plan.structured?.sideEffects ?? []).join('\n').toLowerCase();
}

/**
 * The reader groups a plan's side-effects never mention. A group counts as answered if the text names one
 * of its files, a file's base name, the folder, or one of its routes.
 */
export function unaddressedReaders(groups: ReaderGroup[], plan: { structured?: StructuredPlan }): ReaderGroup[] {
  const text = sideEffectText(plan);
  return groups.filter((g) => {
    const names = [
      ...g.files.flatMap((f) => [f.toLowerCase(), (f.split('/').pop() ?? f).toLowerCase().replace(/\.[^.]+$/, '')]).filter((n) => n.length >= 4),
      ...g.routes.flatMap((r) => [r.toLowerCase(), routePrefix(r).toLowerCase()]).filter((n) => n.length >= 4),
      g.label.replace(/^route /, '').toLowerCase(),
    ].filter((n) => n.length >= 4);
    return !names.some((n) => text.includes(n));
  });
}

/** Issues, as instructions, for readers of the changed files that the plan does not answer for. */
export function readerCoverageIssues(unaddressed: ReaderGroup[]): string[] {
  if (!unaddressed.length) return [];
  const list = unaddressed.map((g) => `${g.label}${g.files.length ? ` (${g.files.slice(0, 3).map((f) => f.split('/').pop()).join(', ')}${g.files.length > 3 ? ', ...' : ''})` : ''}`).join('; ');
  return [`sideEffects: other code reads the files you change. For each of these, say whether your change affects it, or why not (readers in one folder can be answered together): ${list}.`];
}

/**
 * Markdown appended to a plan by Nucleas itself: what was verified, what was not, and what else the
 * change reaches. These are facts from the repository, not the model's claims.
 */
export function automaticPlanSections(input: {
  check: ClaimCheck;
  readers: ReturnType<typeof readersOfPlannedFiles>;
  dataStoreNotes: { file: string; line: number; text: string; note: string }[];
  /** Reader groups the plan never answered for. */
  unaddressed?: ReaderGroup[];
  /** Code around each quoted line, shown so a reader can see what each quote belongs to. */
  contexts?: { file: string; line: number; snippet: string; entry?: string }[];
  /** Problems the checks still found in the final plan (contradictions, wrong line claims). */
  remaining?: string[];
  /** How the run went, e.g. how many correction rounds ran. */
  notes?: string[];
  /** The live page's lines around the request's names, as seen with the admin account. */
  observed?: { url: string; windows: string };
}): string {
  const out: string[] = [];
  const { check } = input;
  const lines: string[] = [];
  const total = check.verified.length + check.unverified.length;
  if (total) lines.push(`- ${check.verified.length} of ${total} quoted lines were found in the repository${check.unverified.length ? ` (not found: ${check.unverified.map((u) => `${u.evidence.file}`).join(', ')})` : ''}.`);
  for (const v of check.verified) {
    if (v.actualLine && v.occurrences === 1) lines.push(`- ${v.evidence.file}: the quote is at line ${v.actualLine}, not ${v.evidence.line}.`);
    else if (v.actualLine) lines.push(`- ${v.evidence.file}: the quote appears ${v.occurrences} times; the nearest to the cited line ${v.evidence.line} is line ${v.actualLine}.`);
    else if (v.ambiguous) lines.push(`- ${v.evidence.file}: the quote appears ${v.occurrences} times, so it does not by itself show which entry is meant.`);
  }
  if (check.offPath.length) lines.push(`- Edits outside the page's data path: ${check.offPath.join(', ')}.`);
  if (check.newOrUnknown.length) lines.push(`- Not found in the repository (new files, or a wrong path): ${check.newOrUnknown.join(', ')}.`);
  for (const r of input.readers) lines.push(`- ${r.file} is also used by ${[...r.usedBy, ...r.routes.map((x) => `route ${x}`)].join(', ')}; a change there reaches them too.`);
  for (const g of input.unaddressed ?? []) lines.push(`- The plan does not say how the change affects: ${g.label} (${[...g.files.slice(0, 4).map((f) => f.split('/').pop()), ...g.routes.slice(0, 2)].join(', ')}).`);
  for (const n of input.dataStoreNotes) lines.push(`- Not verifiable from the repository: ${n.file}:${n.line} ${n.note} (\`${n.text}\`). Stored data may differ from the code.`);
  for (const note of input.notes ?? []) lines.push(`- ${note}`);
  for (const issue of input.remaining ?? []) lines.push(`- Still open: ${issue}`);
  if (lines.length) out.push(`## Automatic checks (from the repository)\n\n${lines.join('\n')}`);
  if (input.observed) out.push(`## What the live page showed (admin account, read-only)\n\n${input.observed.url}\n\n\`\`\`\n${input.observed.windows}\n\`\`\``);
  if (input.contexts?.length) out.push(`## Code around the quoted lines\n\n${input.contexts.slice(0, 3).map((c) => `\`${c.file}:${c.line}\`\n\`\`\`\n${c.snippet}\n\`\`\`${c.entry ? `\n${c.entry}` : ''}`).join('\n\n')}`);
  return out.join('\n\n');
}
