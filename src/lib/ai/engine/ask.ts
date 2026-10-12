import 'server-only';
import { attemptCompanyCredentialChat } from '@/lib/ai/companyChat';
import { assistantLedgerProjectId } from '@/lib/ai/company/assistantLedger';
import { readEngineSettings, selectModel, type CostLevel, type Need, type ModelChoice } from './select';

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

async function run(choice: ModelChoice, input: { organizationId: string; userId: string; system: string; user: string; maxTokens: number }): Promise<string | null> {
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
  }).catch(() => null);
  return turn && turn.role === 'assistant' && turn.text.trim() ? turn.text.trim() : null;
}

export async function askEngine(input: { organizationId: string; userId: string; need: Need; level?: CostLevel; system: string; user: string; maxTokens: number }): Promise<EngineAnswer | null> {
  const settings = await readEngineSettings(input.organizationId);
  const pick = await selectModel(input.organizationId, input.need, input.level ?? settings.defaultCostLevel, { settings });
  if (!pick.primary) return null;
  const text = await run(pick.primary, input);
  if (text) return { text, model: pick.primary.model, usedFallback: false };
  if (pick.fallback) {
    const retry = await run(pick.fallback, input);
    if (retry) return { text: retry, model: pick.fallback.model, usedFallback: true };
  }
  return null;
}
