/**
 * Checks a plan's claims against the repository instead of trusting them. A model can write a confident
 * sentence about code it never read; it cannot make a quote appear in a file. Every quoted line is looked
 * up, planned edits are compared with the code the named page actually uses, and the other readers of the
 * files to be changed are listed, all deterministically.
 */
import type { PlanEvidence, StructuredPlan } from '@/lib/ide/planStructure';
import { plannedFiles } from '@/lib/ide/planStructure';
import { findReferences } from './references';

export interface ClaimCheck {
  /** Quotes found in the cited file. `line` is the line where the quote really is when the cited line was off. */
  verified: { evidence: PlanEvidence; actualLine?: number }[];
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

/** Line number (1-based) where the fragment starts, or -1. */
function lineOf(content: string, fragment: string): number {
  const lines = content.split('\n');
  const target = squash(fragment);
  for (let i = 0; i < lines.length; i += 1) if (squash(lines[i]).includes(target)) return i + 1;
  // A quote that spans lines: find it in the squashed whole and count newlines before it.
  const whole = squash(content);
  const at = whole.indexOf(target);
  if (at < 0) return -1;
  return 1 + (content.slice(0, Math.min(content.length, at)).match(/\n/g)?.length ?? 0);
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
    const positions = fragments.map((f) => lineOf(content, f));
    if (!fragments.length || positions.some((p) => p < 0)) { unverified.push({ evidence, reason: 'quote_not_found' }); continue; }
    const actual = positions[0];
    verified.push({ evidence, ...(evidence.line && Math.abs(evidence.line - actual) > 3 ? { actualLine: actual } : {}) });
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
  if (missingPathFiles.length) issues.push(`path: ${missingPathFiles.slice(0, 4).join(', ')} not found in the repository. List only files that exist.`);
  if (evidenceOffPath) issues.push('rootCause.evidence: none of the quoted code is in a file the named page uses. Trace how the page gets its data and quote the code on that path.');
  if (offPath.length) issues.push(`filesToChange: ${offPath.slice(0, 4).join(', ')} is not used by the page the request names, so editing it would not change what the page shows. Edit code on the page's data path, or explain what else reads it.`);
  return { verified, unverified, missingPathFiles, offPath, newOrUnknown, evidenceOffPath, issues };
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

/**
 * Markdown appended to a plan by Nucleas itself: what was verified, what was not, and what else the
 * change reaches. These are facts from the repository, not the model's claims.
 */
export function automaticPlanSections(input: {
  check: ClaimCheck;
  readers: ReturnType<typeof readersOfPlannedFiles>;
  dataStoreNotes: { file: string; line: number; text: string; note: string }[];
}): string {
  const out: string[] = [];
  const { check } = input;
  const lines: string[] = [];
  const total = check.verified.length + check.unverified.length;
  if (total) lines.push(`- ${check.verified.length} of ${total} quoted lines were found in the repository${check.unverified.length ? ` (not found: ${check.unverified.map((u) => `${u.evidence.file}`).join(', ')})` : ''}.`);
  for (const v of check.verified) if (v.actualLine) lines.push(`- ${v.evidence.file}: the quote is at line ${v.actualLine}, not ${v.evidence.line}.`);
  if (check.offPath.length) lines.push(`- Edits outside the page's data path: ${check.offPath.join(', ')}.`);
  if (check.newOrUnknown.length) lines.push(`- Not found in the repository (new files, or a wrong path): ${check.newOrUnknown.join(', ')}.`);
  for (const r of input.readers) lines.push(`- ${r.file} is also used by ${[...r.usedBy, ...r.routes.map((x) => `route ${x}`)].join(', ')}; a change there reaches them too.`);
  for (const n of input.dataStoreNotes) lines.push(`- Not verifiable from the repository: ${n.file}:${n.line} ${n.note} (\`${n.text}\`). Stored data may differ from the code.`);
  if (lines.length) out.push(`## Automatic checks (from the repository)\n\n${lines.join('\n')}`);
  return out.join('\n\n');
}
