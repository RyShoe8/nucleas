export type ModelPathLevel = 'free' | 'low' | 'medium' | 'high';

/** One model call in a run: which model, why the engine chose it, and what it cost. */
export interface ModelStep {
  stage: 'work' | 'review';
  /** What this call did, e.g. "First attempt" or "Format retry". */
  note: string;
  model: string;
  free: boolean;
  source: 'pinned' | 'auto';
  level: ModelPathLevel;
  /** Paid retry used only because the free model failed. */
  fallback: boolean;
  /** Null when the model is paid but no token price is on file, so the real cost is unknown. */
  costMicros: number | null;
  reason: string;
}

const LEVEL_LABEL: Record<ModelPathLevel, string> = { free: 'Free', low: 'Low', medium: 'Medium', high: 'High' };

/** Plain-language reason the engine picked this model, mirroring the rules in engine/select.ts. */
export function modelStepReason(input: { stage: 'work' | 'review'; level: ModelPathLevel; free: boolean; source: 'pinned' | 'auto'; fallback: boolean }): string {
  const level = LEVEL_LABEL[input.level];
  if (input.source === 'pinned') return 'Chosen for this task and level in AI Engine settings.';
  if (input.level === 'free') return 'The Free level uses only free models.';
  if (input.stage === 'review') {
    return input.free
      ? 'No paid model was eligible to review, so a free model did.'
      : `${level} level: the strongest paid model within its price ceiling reviews.`;
  }
  if (input.fallback) return `${level} level: a paid retry, used only because the free model failed.`;
  if (input.free) {
    return `${level} level: the free model does the work${input.level === 'medium' ? ', with a paid retry only if it fails' : ' and never pays to retry'}.`;
  }
  return `${level} level: the strongest paid model within the Medium price ceiling does the work.`;
}

export function costSummary(steps: readonly ModelStep[]): { knownMicros: number; unknownModels: string[] } {
  const unknown = new Set<string>();
  let known = 0;
  for (const step of steps) {
    if (step.costMicros === null) {
      if (!step.free) unknown.add(step.model);
    } else known += step.costMicros;
  }
  return { knownMicros: known, unknownModels: [...unknown] };
}
