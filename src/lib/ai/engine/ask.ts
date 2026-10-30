import 'server-only';
import { attemptCompanyCredentialChat } from '@/lib/ai/companyChat';
import { assistantLedgerProjectId } from '@/lib/ai/company/assistantLedger';
import { readEngineSettings, selectModel, type CostLevel, type Need, type ModelChoice } from './select';
import { freeModelBusy } from '@/lib/ai/control/dispatchLock';

/**
 * The one way a feature asks the AI engine for a single plain-text answer. The organization's cost level
 * (or an explicit one) and its per-level choices decide the model for the need, so free models do the
 * work wherever the level says they do. At the medium level a failed free model is retried once on the
 * level's paid pick; low and free never pay to retry. The model that answered is returned so callers can
 * record the path.
 */
export interface EngineAnswer {
  text: string;
  model: string;
  /** True when the free primary failed and the paid fallback answered. */
  usedFallback: boolean;
}

type AskInput = { organizationId: string; userId: string; system: string; user: string; maxTokens: number; signal?: AbortSignal; attemptTimeoutMs?: number; onFailure?: (failure: EngineFailure) => void };

/** Why a model gave no answer, for the caller's logs: which model, and what went wrong. */
export interface EngineFailure {
  model: string;
  reason: string;
}

async function run(choice: ModelChoice, input: AskInput): Promise<string | null> {
  if (input.signal?.aborted) {
    input.onFailure?.({ model: choice.model, reason: 'Timed out before the model was called.' });
    return null;
  }
  // Each model gets its own clock: a slow free model must not use up the time its paid fallback needs.
  const attempt = input.attemptTimeoutMs ? AbortSignal.timeout(input.attemptTimeoutMs) : null;
  const signal = attempt && input.signal ? AbortSignal.any([input.signal, attempt]) : attempt ?? input.signal;
  const started = Date.now();
  const timedOut = () => `Timed out waiting for the model after ${Math.round((Date.now() - started) / 1000)}s${attempt?.aborted ? ' (its own time limit; the next model gets a fresh one)' : ''}.`;
  const turn = await attemptCompanyCredentialChat({
    systemPrompt: input.system,
    organizationId: input.organizationId,
    projectId: assistantLedgerProjectId(input.organizationId),
    userId: input.userId,
    userText: input.user,
    priorTurns: [],
    modelProfileId: choice.profileId,
    model: choice.model,
    includeRepoTools: false,
    includeImageTool: false,
    toolProfile: 'none',
    forcePlain: true,
    stopOnUpstreamFailure: true,
    maxOutputTokensOverride: input.maxTokens,
    signal: signal ?? undefined,
  }).catch((error: unknown) => {
    input.onFailure?.({ model: choice.model, reason: signal?.aborted ? timedOut() : error instanceof Error ? error.message : 'The model call failed.' });
    return undefined;
  });
  if (turn === undefined) return null;
  if (turn && turn.role === 'assistant' && turn.text.trim()) return turn.text.trim();
  const reason = signal?.aborted ? timedOut() : turn?.role === 'assistant' ? 'The model returned an empty answer.' : `${turn?.text ?? 'No answer.'}${turn?.failureCategory ? ` (${turn.failureCategory}${turn.debugHint ? `: ${turn.debugHint}` : ''})` : ''}`;
  input.onFailure?.({ model: choice.model, reason: reason.slice(0, 300) });
  return null;
}

/**
 * attemptTimeoutMs: how long each model may take, the primary and then its fallback, each with a fresh
 * limit. Prefer this: a single overall signal lets a slow free model use up the fallback's time.
 * signal: an overall limit or cancellation on top of that (and frees the shared free-model queue).
 * onFailure: told about each model that gave no answer and why, so callers can record it.
 */
export async function askEngine(input: { organizationId: string; userId: string; need: Need; level?: CostLevel; system: string; user: string; maxTokens: number; signal?: AbortSignal; attemptTimeoutMs?: number; interactive?: boolean; onFailure?: (failure: EngineFailure) => void }): Promise<EngineAnswer | null> {
  const settings = await readEngineSettings(input.organizationId);
  const pick = await selectModel(input.organizationId, input.need, input.level ?? settings.defaultCostLevel, { settings });
  if (!pick.primary) {
    input.onFailure?.({ model: 'none', reason: `No model is available for "${input.need}" work. Check AI settings.` });
    return null;
  }
  // A person is waiting and the free model is busy with background work: the level's paid fallback answers
  // now instead of queueing. Background work keeps queueing for the free model, which does the bulk of it.
  if (input.interactive && pick.primary.free && pick.fallback && (await freeModelBusy().catch(() => false))) {
    const now = await run(pick.fallback, input);
    if (now) return { text: now, model: pick.fallback.model, usedFallback: true };
    const later = await run(pick.primary, input);
    return later ? { text: later, model: pick.primary.model, usedFallback: false } : null;
  }
  const text = await run(pick.primary, input);
  if (text) return { text, model: pick.primary.model, usedFallback: false };
  if (pick.fallback) {
    const retry = await run(pick.fallback, input);
    if (retry) return { text: retry, model: pick.fallback.model, usedFallback: true };
  }
  return null;
}
