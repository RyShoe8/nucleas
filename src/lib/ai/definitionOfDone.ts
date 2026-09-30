/**
 * Reads the worker's own typecheck/lint results (evidence tagged `definition_of_done`). These come from
 * commands the worker ran itself after the build, so they don't depend on what the model claimed.
 */

export interface DodEvidenceInput {
  command: string[];
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  kind?: string;
}

export type DodState = 'passed' | 'failed' | 'skipped';

export interface DodCheckResult {
  name: 'install' | 'typecheck' | 'lint';
  state: DodState;
  command: string;
  /** Tail of the output (where errors appear) for failed and skipped checks. */
  excerpt: string;
}

export interface DodResult {
  /** No definition-of-done evidence at all (older worker, non-Node repo, or checks disabled). */
  ran: boolean;
  state: 'passed' | 'failed' | 'incomplete' | 'none';
  checks: DodCheckResult[];
}

function nameOf(command: string[]): DodCheckResult['name'] {
  const joined = command.join(' ');
  if (/\b(?:ci|install)\b/.test(joined) && /^npm\b/.test(joined)) return 'install';
  if (/\beslint\b|\brun\s+lint\b/.test(joined)) return 'lint';
  return 'typecheck';
}

export function evaluateDefinitionOfDone(evidence: DodEvidenceInput[]): DodResult {
  const own = evidence.filter((item) => item.kind === 'definition_of_done');
  if (!own.length) return { ran: false, state: 'none', checks: [] };
  const checks = own.map((item): DodCheckResult => {
    const name = nameOf(item.command);
    const skipped = item.exitCode === null && /^Skipped /.test(item.output);
    const state: DodState = skipped ? 'skipped' : item.exitCode === 0 && !item.timedOut ? 'passed' : 'failed';
    const output = item.output.trim();
    return {
      name, state, command: item.command.join(' '),
      excerpt: state === 'passed' ? '' : (item.timedOut ? `Timed out. ${output}` : output).slice(-1500),
    };
  });
  // A failed install means typecheck and lint never ran: that is "incomplete", not a code failure.
  const installFailed = checks.some((c) => c.name === 'install' && c.state === 'failed');
  const failed = checks.some((c) => c.state === 'failed' && c.name !== 'install');
  const state = failed ? 'failed' : installFailed || checks.some((c) => c.state === 'skipped') ? 'incomplete' : 'passed';
  return { ran: true, state, checks };
}

const MARK: Record<DodState, string> = { passed: '✅', failed: '‼️', skipped: '⏭️' };

/** Markdown block placed first in the worker report, so the Reviewer sees it before anything else. */
export function formatDefinitionOfDone(result: DodResult): string {
  if (!result.ran) return '';
  const headline = {
    passed: 'Definition of done: passed (the worker ran these itself on the finished patch).',
    failed: 'Definition of done: FAILED — the patch does not typecheck/lint cleanly. Do not treat this build as complete.',
    incomplete: 'Definition of done: incomplete — some checks could not run, so the patch is not verified.',
    none: '',
  }[result.state];
  const lines = result.checks.map((c) => `- ${MARK[c.state]} ${c.name}: \`${c.command}\`${c.state === 'passed' ? '' : ` — ${c.state}`}`);
  const details = result.checks.filter((c) => c.state !== 'passed' && c.excerpt).map((c) => `${c.name} output (tail):\n\`\`\`\n${c.excerpt}\n\`\`\``);
  return [headline, ...lines, ...details].join('\n');
}
