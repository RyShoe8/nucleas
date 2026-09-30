/**
 * The structure a plan must have, so a small model cannot hide a weak plan behind fluent prose:
 * the symptom, the code path from it to the cause, the cause with quoted evidence, the change, what the
 * user will see afterwards, what else the change touches, what could not be verified, and what is left
 * alone. Parsing is tolerant (models vary how they write lists); validation is strict and its messages are
 * written to be pasted back to the model as corrections.
 */

export type PlanEvidence = { file: string; line?: number; quote: string };
export type PlanPathHop = { file: string; line?: number; note?: string };

export type StructuredPlan = {
  symptom?: string;
  path?: PlanPathHop[];
  rootCause?: { explanation: string; evidence: PlanEvidence[] };
  filesToChange?: string[];
  expectedResult?: string;
  sideEffects?: string[];
  unverified?: string[];
  outOfScope?: string[];
};

const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strings = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, max) : typeof v === 'string' && v.trim() ? [v.trim().slice(0, 400)] : [];

/** "path/to/file.ts:42" or "path/to/file.ts" at the start of a string. */
const LOCATION = /^\s*[`'"]?((?:[\w@.~-]+\/)*[\w@.~-]+\.[A-Za-z0-9]+)(?::(\d+))?[`'"]?\s*/;

function parseEvidenceItem(item: unknown): PlanEvidence | null {
  if (item && typeof item === 'object') {
    const r = item as Record<string, unknown>;
    const file = str(r.file ?? r.path, 300);
    const quote = str(r.quote ?? r.snippet ?? r.text ?? r.code, 400);
    const line = Number(r.line);
    return file && quote ? { file, quote, ...(Number.isInteger(line) && line > 0 ? { line } : {}) } : null;
  }
  if (typeof item === 'string') {
    // "src/a.ts:12 `const x = 1`" written as one string.
    const m = LOCATION.exec(item);
    if (!m) return null;
    const quote = item.slice(m[0].length).replace(/^[\s:—–-]+/, '').replace(/^[`'"]|[`'"]$/g, '').trim();
    return quote ? { file: m[1], quote: quote.slice(0, 400), ...(m[2] ? { line: Number(m[2]) } : {}) } : null;
  }
  return null;
}

function parsePathItem(item: unknown): PlanPathHop | null {
  if (item && typeof item === 'object') {
    const r = item as Record<string, unknown>;
    const file = str(r.file ?? r.path, 300);
    const line = Number(r.line);
    const note = str(r.note ?? r.role ?? r.description, 300);
    return file ? { file, ...(Number.isInteger(line) && line > 0 ? { line } : {}), ...(note ? { note } : {}) } : null;
  }
  if (typeof item === 'string') {
    const m = LOCATION.exec(item);
    if (!m) return null;
    const note = item.slice(m[0].length).replace(/^[\s:—–-]+/, '').trim();
    return { file: m[1], ...(m[2] ? { line: Number(m[2]) } : {}), ...(note ? { note: note.slice(0, 300) } : {}) };
  }
  return null;
}

/** Reads the optional structured fields of a plan record. Returns undefined when none are present. */
export function parseStructuredPlan(record: Record<string, unknown>): StructuredPlan | undefined {
  const out: StructuredPlan = {};
  const symptom = str(record.symptom, 800);
  if (symptom) out.symptom = symptom;
  if (Array.isArray(record.path)) {
    const hops = record.path.map(parsePathItem).filter((h): h is PlanPathHop => Boolean(h)).slice(0, 12);
    if (hops.length) out.path = hops;
  }
  const cause = record.rootCause ?? record.root_cause;
  if (typeof cause === 'string' && cause.trim()) out.rootCause = { explanation: cause.trim().slice(0, 1200), evidence: [] };
  else if (cause && typeof cause === 'object') {
    const c = cause as Record<string, unknown>;
    const explanation = str(c.explanation ?? c.cause ?? c.summary, 1200);
    const evidence = (Array.isArray(c.evidence) ? c.evidence : []).map(parseEvidenceItem).filter((e): e is PlanEvidence => Boolean(e)).slice(0, 10);
    if (explanation || evidence.length) out.rootCause = { explanation, evidence };
  }
  // Evidence written beside the cause instead of inside it.
  if (Array.isArray(record.evidence) && out.rootCause && !out.rootCause.evidence.length) {
    out.rootCause.evidence = record.evidence.map(parseEvidenceItem).filter((e): e is PlanEvidence => Boolean(e)).slice(0, 10);
  }
  const files = strings(record.filesToChange ?? record.files_to_change ?? record.files, 12)
    .map((f) => LOCATION.exec(f)?.[1] ?? f)
    .filter(Boolean);
  if (files.length) out.filesToChange = [...new Set(files)];
  const expected = str(record.expectedResult ?? record.expected_result ?? record.prediction, 800);
  if (expected) out.expectedResult = expected;
  for (const [key, aliases] of [['sideEffects', ['side_effects', 'otherReaders']], ['unverified', ['unverifiedAssumptions', 'unknowns']], ['outOfScope', ['out_of_scope', 'notChanging']]] as const) {
    const list = strings(record[key] ?? aliases.map((a) => record[a]).find((v) => v !== undefined));
    if (list.length) out[key] = list;
    else if (key in record || aliases.some((a) => a in record)) out[key] = []; // present but empty: "none"
  }
  return Object.keys(out).length ? out : undefined;
}

const FILLER_STEP = /^\s*(?:verify|ensure|check|confirm|review|make sure|validate|test that|double[- ]check)\b/i;
const FILE_IN_TEXT = /(?:[\w@.~-]+\/)+[\w@.~-]+\.[A-Za-z0-9]{1,6}\b/;

/**
 * What is wrong with a plan's structure, phrased as instructions to fix it. Empty when it is complete.
 * `hasKnownPath` says the repository trace found a page-to-data path, in which case the plan must use it.
 */
export function validatePlanStructure(plan: { steps: string[]; structured?: StructuredPlan }, options: { hasKnownPath?: boolean } = {}): string[] {
  const s = plan.structured;
  const issues: string[] = [];
  if (!s) return ['The plan has none of the required fields. Return the full JSON with symptom, path, rootCause (explanation + evidence), filesToChange, expectedResult, sideEffects, unverified, outOfScope and steps.'];
  if (!s.symptom) issues.push('symptom: restate the problem the user sees, in one sentence.');
  if (!s.path?.length) {
    issues.push(options.hasKnownPath
      ? 'path: list the files from where the user sees the problem to where the data comes from (file:line and what each does). Use the "Data path" in the evidence.'
      : 'path: list the files from where the user sees the problem to the code or data that causes it.');
  }
  if (!s.rootCause?.explanation) issues.push('rootCause.explanation: explain in 2-4 steps how the current code produces the exact symptom.');
  else if (!s.rootCause.evidence.length) issues.push('rootCause.evidence: quote the code that produces the symptom as {file, line, quote}. Claims without a quote are not accepted.');
  else if (s.rootCause.evidence.some((e) => e.quote.replace(/\s+/g, '').length < 6)) issues.push('rootCause.evidence: each quote must be an actual line of code (at least a few characters), copied exactly.');
  if (!s.filesToChange?.length) issues.push('filesToChange: list the files the change edits.');
  if (!s.expectedResult) issues.push('expectedResult: say what the user will see after the change and why, pointing to the code that renders it.');
  if (!s.sideEffects) issues.push('sideEffects: list other places that read the code or data you change, or [] if none.');
  if (!s.unverified) issues.push('unverified: list anything you could not confirm from the code (database contents, production settings), or [] if none.');
  if (!s.outOfScope) issues.push('outOfScope: say what you are deliberately not changing and why, or [] if nothing.');
  if (!plan.steps.length) issues.push('steps: list the changes to make, one per step.');
  const filler = plan.steps.filter((step) => FILLER_STEP.test(step) && !FILE_IN_TEXT.test(step));
  if (plan.steps.length && filler.length > plan.steps.length / 2) {
    issues.push('steps: most steps only verify or restate the goal. Keep only steps that change a named file or run a specific check.');
  }
  return issues;
}

/** Markdown sections for a plan document. */
export function renderStructuredSections(s: StructuredPlan | undefined): string {
  if (!s) return '';
  const out: string[] = [];
  const loc = (file: string, line?: number) => (line ? `${file}:${line}` : file);
  if (s.symptom) out.push(`## Symptom\n\n${s.symptom}`);
  if (s.path?.length) out.push(`## Code path\n\n${s.path.map((h) => `- \`${loc(h.file, h.line)}\`${h.note ? ` — ${h.note}` : ''}`).join('\n')}`);
  if (s.rootCause) {
    out.push([`## Root cause`, s.rootCause.explanation, s.rootCause.evidence.length ? `Evidence:\n${s.rootCause.evidence.map((e) => `- \`${loc(e.file, e.line)}\`: \`${e.quote}\``).join('\n')}` : ''].filter(Boolean).join('\n\n'));
  }
  if (s.filesToChange?.length) out.push(`## Files to change\n\n${s.filesToChange.map((f) => `- \`${f}\``).join('\n')}`);
  if (s.expectedResult) out.push(`## Expected result\n\n${s.expectedResult}`);
  if (s.sideEffects) out.push(`## Side effects and other readers\n\n${s.sideEffects.length ? s.sideEffects.map((x) => `- ${x}`).join('\n') : 'None found.'}`);
  if (s.unverified) out.push(`## Unverified\n\n${s.unverified.length ? s.unverified.map((x) => `- ${x}`).join('\n') : 'Nothing outstanding.'}`);
  if (s.outOfScope) out.push(`## Out of scope\n\n${s.outOfScope.length ? s.outOfScope.map((x) => `- ${x}`).join('\n') : 'Nothing.'}`);
  return out.join('\n\n');
}

/** Every file a plan says it will change, from its field and from paths written in its steps. */
export function plannedFiles(plan: { steps: string[]; structured?: StructuredPlan }): string[] {
  const fromSteps = plan.steps.flatMap((step) => [...step.matchAll(new RegExp(FILE_IN_TEXT.source, 'g'))].map((m) => m[0]));
  return [...new Set([...(plan.structured?.filesToChange ?? []), ...fromSteps])];
}
