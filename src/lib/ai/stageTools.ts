/**
 * Which tools each pipeline stage actually called, so a model that answered without ever looking at
 * the repository is visible at a glance instead of hiding behind a confident-sounding report.
 */

export type PipelineStage = 'planner' | 'worker' | 'reviewer';

export interface StageToolRecord {
  stage: PipelineStage;
  model: string;
  toolsUsed: string[];
  /** The stage was retried without tools ("compact" recovery) after an upstream error. */
  compact?: boolean;
}

const LABEL: Record<PipelineStage, string> = { planner: 'Planner', worker: 'Worker', reviewer: 'Reviewer' };
const ORDER: PipelineStage[] = ['planner', 'worker', 'reviewer'];

/** Merge repeated passes of the same stage on the same model (the worker often runs twice). */
export function mergeStageTools(records: StageToolRecord[]): StageToolRecord[] {
  const merged = new Map<string, StageToolRecord>();
  for (const record of records) {
    const key = `${record.stage}\u0000${record.model}`;
    const existing = merged.get(key);
    if (existing) {
      for (const tool of record.toolsUsed) if (!existing.toolsUsed.includes(tool)) existing.toolsUsed.push(tool);
      if (record.compact) existing.compact = true;
    } else {
      merged.set(key, { ...record, toolsUsed: [...new Set(record.toolsUsed)] });
    }
  }
  return [...merged.values()].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage));
}

export interface StageToolSummary {
  records: StageToolRecord[];
  /** Stages that should have looked at the code but never called a repository tool. */
  warnings: string[];
  markdown: string;
}

/**
 * The Reviewer is tool-free by design, so it never counts as a gap. Planner and Worker are expected to
 * call repo tools; in Build mode the Worker edits in a sandbox instead, so any tool at all counts.
 */
export function stageLackedRepoTools(record: StageToolRecord, buildMode = false): boolean {
  if (record.stage === 'reviewer') return false;
  if (buildMode && record.stage === 'worker') return record.toolsUsed.length === 0;
  return !record.toolsUsed.some((tool) => tool.startsWith('repo_'));
}

export function summarizeStageTools(input: StageToolRecord[], options: { buildMode?: boolean } = {}): StageToolSummary {
  const records = mergeStageTools(input);
  const warnings: string[] = [];
  const lines = records.map((record) => {
    const label = `${LABEL[record.stage]} (${record.model})`;
    if (record.stage === 'reviewer') return `- ${label}: no tools (by design)`;
    if (stageLackedRepoTools(record, options.buildMode)) {
      warnings.push(`${LABEL[record.stage]} (${record.model}) never called a repository tool, so its findings are not grounded in a search or read${record.compact ? ' (it was retried in compact mode with tools switched off after an upstream error)' : ''}.`);
      return `- ${label}: ${record.toolsUsed.length ? record.toolsUsed.join(', ') : 'none'} ⚠ no repository tools${record.compact ? ' (compact mode)' : ''}`;
    }
    return `- ${label}: ${record.toolsUsed.join(', ')}`;
  });
  const markdown = records.length ? ['**Tools used**', ...lines].join('\n') : '';
  return { records, warnings, markdown };
}

/**
 * Removes the plain-text tools report (and the per-stage warnings) that teamChat appends to a reply, for
 * screens that render the structured `stageTools` instead. Other Nucleas notes in the footer stay.
 */
export function stripStageToolsFooter(text: string): string {
  return text
    .replace(/\n*\*\*Tools used\*\*\n(?:- [^\n]*(?:\n|$))+/g, '\n')
    .replace(/^⚠ (?:Planner|Worker|Reviewer) \([^)\n]*\) never called a repository tool[^\n]*\n*/gm, '')
    .replace(/\n+---\s*$/, '')
    .trimEnd();
}
