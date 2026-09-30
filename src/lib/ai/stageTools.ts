/**
 * Which tools each pipeline stage actually called, so a model that answered without ever looking at
 * the repository is visible at a glance instead of hiding behind a confident-sounding report.
 */

export type PipelineStage = 'planner' | 'worker' | 'reviewer';

export interface StageToolRecord {
  stage: PipelineStage;
  model: string;
  toolsUsed: string[];
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
 * The Reviewer is tool-free by design. Planner and Worker are expected to call repo tools; in Build
 * mode the Worker edits in a sandbox instead, so any tool at all counts.
 */
export function summarizeStageTools(input: StageToolRecord[], options: { buildMode?: boolean } = {}): StageToolSummary {
  const records = mergeStageTools(input);
  const warnings: string[] = [];
  const lines = records.map((record) => {
    const label = `${LABEL[record.stage]} (${record.model})`;
    if (record.stage === 'reviewer') return `- ${label}: no tools (by design)`;
    const usedRepo = record.toolsUsed.some((tool) => tool.startsWith('repo_'));
    const ok = options.buildMode && record.stage === 'worker' ? record.toolsUsed.length > 0 : usedRepo;
    if (!ok) {
      warnings.push(`${LABEL[record.stage]} (${record.model}) never called a repository tool, so its findings are not grounded in a search or read.`);
      return `- ${label}: ${record.toolsUsed.length ? record.toolsUsed.join(', ') : 'none'} ⚠ no repository tools`;
    }
    return `- ${label}: ${record.toolsUsed.join(', ')}`;
  });
  const markdown = records.length ? ['**Tools used**', ...lines].join('\n') : '';
  return { records, warnings, markdown };
}
