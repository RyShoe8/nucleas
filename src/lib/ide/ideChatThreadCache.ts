import type { IdeChatMode } from '@/lib/ide/modes';
import { isIdeDirectMode } from '@/lib/ide/modes';
import type { IdeChatStage } from '@/lib/ide/ideChatStream';

/** Client-side transcript cache key for IDE chat tabs (must include project). */
export function ideChatThreadCacheKey(input: {
  projectId: string;
  mode: IdeChatMode;
  modelProfileId?: string;
  model?: string;
}): string {
  const project = input.projectId.trim() || '_none';
  if (!isIdeDirectMode(input.mode)) return `${project}:orchestrated`;
  return `${project}:direct:${input.modelProfileId?.trim() ?? ''}:${input.model?.trim() ?? ''}`;
}

export type IdeDeskStatus = 'idle' | 'active' | 'done';

export type IdeDioramaDesk = {
  role: 'direct' | 'planner' | 'worker' | 'reviewer';
  modelLabel: string;
  /** True when this desk is the live stage. */
  active: boolean;
  status: IdeDeskStatus;
  /** Short status under the model name (office activity). */
  activityLabel?: string;
};

function statusForRole(
  role: IdeChatStage,
  busy: boolean,
  activeStage: IdeChatStage | null,
  doneStages: ReadonlySet<IdeChatStage>
): IdeDeskStatus {
  if (!busy) return 'idle';
  if (activeStage === role) return 'active';
  if (doneStages.has(role)) return 'done';
  return 'idle';
}

export function buildDioramaDesks(input: {
  direct?: boolean;
  directModelLabel?: string;
  stages?: { planner?: string; worker?: string; reviewer?: string };
  busy?: boolean;
  /** Which stage is actually running (IDE chat/pipeline). */
  activeStage?: IdeChatStage | null;
  /** Stages that finished earlier in this turn. */
  doneStages?: IdeChatStage[];
}): IdeDioramaDesk[] {
  const busy = Boolean(input.busy);
  const active = busy ? input.activeStage ?? null : null;
  const done = new Set(input.doneStages ?? []);

  if (input.direct) {
    const status = statusForRole('direct', busy, active ?? (busy ? 'direct' : null), done);
    return [
      {
        role: 'direct',
        modelLabel: input.directModelLabel?.trim() || 'Direct',
        active: status === 'active',
        status,
      },
    ];
  }

  const stages = input.stages ?? {};
  const fallbackActive: IdeChatStage | null = busy ? active ?? 'worker' : null;

  return (['planner', 'worker', 'reviewer'] as const).map((role) => {
    const status = statusForRole(role, busy, fallbackActive, done);
    const label =
      role === 'planner'
        ? stages.planner?.trim() || 'Planner'
        : role === 'worker'
          ? stages.worker?.trim() || 'Worker'
          : stages.reviewer?.trim() || 'Reviewer';
    return {
      role,
      modelLabel: label,
      active: status === 'active',
      status,
    };
  });
}
