import 'server-only';
import { attemptCompanyCredentialChat } from '@/lib/ai/companyChat';
import type { TeamChatTurn } from '@/lib/ai/teamChat';
import type { IdeInteractionMode } from '@/lib/ide/idePlan';
import type { IdeChatStageCallback } from '@/lib/ide/ideChatStream';
import { withStage } from '@/lib/ide/ideChatStream';
import {
  appendInteractionModePrompt,
  shouldForcePlainChat,
  toolProfileForInteractionMode,
} from '@/lib/ide/planModePrompt';
import { parseNucleasPlan } from '@/lib/ide/parseNucleasPlan';
import { Types } from 'mongoose';

/**
 * Single-model IDE chat via a company credential (Direct mode).
 * Uses pipeline admission + tool loop (not the platform shared bearer).
 */
export async function attemptDirectModelChat(input: {
  projectName: string;
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  userText: string;
  priorTurns: { role: 'user' | 'assistant' | 'status'; text: string }[];
  modelProfileId: string;
  model: string;
  ruleTexts?: string[];
  interactionMode?: IdeInteractionMode;
  /** False for Free Chat (no GitHub binding). Default true. */
  includeRepoTools?: boolean;
  signal?: AbortSignal;
  onStage?: IdeChatStageCallback;
}): Promise<TeamChatTurn> {
  const interactionMode = input.interactionMode ?? 'chat';
  const includeRepo = input.includeRepoTools !== false;
  const toolProfile = includeRepo ? toolProfileForInteractionMode(interactionMode) : 'full';

  const ruleBlock =
    input.ruleTexts && input.ruleTexts.length > 0
      ? ['Project task rules you must follow:', ...input.ruleTexts.map((rule, index) => `${index + 1}. ${rule}`)].join(
          '\n'
        )
      : null;
  const basePrompt = [
    `You are a helpful assistant on the Nucleas project "${input.projectName}".`,
    'Reply helpfully and briefly. Do not claim to have changed project data or completed tasks outside this chat.',
    'You may call provided tools. Never claim browse, repo, or image results without tool output. If a tool fails, say so from the error—do not invent results.',
    includeRepo
      ? 'Prefer repo_search/repo_read for this codebase; web_search only for external/public facts.'
      : 'Prefer web_search/web_fetch for external research.',
    'If you lack information or tools, say what is missing instead of inventing facts.',
    ...(ruleBlock ? [ruleBlock] : []),
  ]
    .filter(Boolean)
    .join(' ');

  const turn = await withStage(input.onStage, 'direct', () =>
    attemptCompanyCredentialChat({
      systemPrompt: appendInteractionModePrompt(basePrompt, interactionMode),
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      userText: input.userText,
      priorTurns: input.priorTurns,
      modelProfileId: input.modelProfileId,
      model: input.model,
      projectName: includeRepo ? input.projectName : undefined,
      includeImageTool: toolProfile === 'full',
      includeRepoTools: includeRepo,
      toolProfile: includeRepo ? toolProfile : 'full',
      forcePlain: shouldForcePlainChat(interactionMode),
      forceToolLoop: includeRepo && (interactionMode === 'plan' || interactionMode === 'build'),
      maxOutputTokensOverride:
        interactionMode === 'plan' || interactionMode === 'build' ? 8192 : undefined,
      signal: input.signal,
    })
  );

  if (interactionMode === 'plan' && turn.role === 'assistant') {
    const parsed = parseNucleasPlan(turn.text);
    if (parsed) {
      return { ...turn, text: parsed.displayText, plan: parsed.plan };
    }
  }
  return turn;
}
