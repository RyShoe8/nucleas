'use client';

import { mergeStageTools, stageLackedRepoTools, type StageToolRecord } from '@/lib/ai/stageTools';

const LABEL = { planner: 'Planner', worker: 'Worker', reviewer: 'Reviewer' } as const;

/**
 * Which tools each pipeline stage actually called. Opens by itself when a Planner or Worker answered
 * without ever searching or reading the repository, since that answer is not grounded in the code.
 */
export default function StageToolsPanel({ stageTools }: { stageTools: StageToolRecord[] }) {
  const records = mergeStageTools(stageTools);
  if (!records.length) return null;
  // A Build worker edits in a sandbox instead of calling repo tools.
  const buildMode = records.some((record) => record.toolsUsed.includes('sandbox_edit'));
  const gaps = records.filter((record) => stageLackedRepoTools(record, buildMode));
  return (
    <details open={gaps.length > 0} className="mt-2 rounded border border-border/70 bg-background/50 px-2 py-1 text-[11px] text-text-secondary">
      <summary className="cursor-pointer select-none">
        Tools by stage
        {gaps.length ? (
          <span className="ml-2 text-amber-400">
            ⚠ {gaps.map((record) => LABEL[record.stage]).join(' and ')} never looked at the repository
          </span>
        ) : null}
      </summary>
      <ul className="mt-1 space-y-1">
        {records.map((record) => {
          const gap = stageLackedRepoTools(record, buildMode);
          return (
            <li key={`${record.stage}:${record.model}`} className="flex flex-wrap items-center gap-1">
              <span className="w-16 shrink-0 font-medium text-text-primary">{LABEL[record.stage]}</span>
              <span className="max-w-[14rem] truncate font-mono" title={record.model}>{record.model}</span>
              {record.stage === 'reviewer' ? (
                <span className="italic">no tools (by design)</span>
              ) : record.toolsUsed.length ? (
                record.toolsUsed.map((tool) => (
                  <span key={tool} className="rounded border border-border/70 px-1 font-mono">{tool}</span>
                ))
              ) : (
                <span className="text-amber-400">none</span>
              )}
              {gap && record.toolsUsed.length ? <span className="text-amber-400">no repository tools</span> : null}
              {record.compact ? <span className="text-amber-400" title="Retried without tools after an upstream error">compact mode</span> : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
