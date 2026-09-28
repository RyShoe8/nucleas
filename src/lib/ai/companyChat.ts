import 'server-only';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import {
  GatewayError,
  invokeModel,
  usesMaxCompletionTokens,
  type GatewayConfiguration,
} from '@nucleas/ai-core/gateway';
import { digestValue } from '@nucleas/ai-core/planning';
import { getPipelineInferencePolicy } from '@/lib/ai/control/config';
import { reserveRunBudget, settleRunBudget } from '@/lib/ai/control/budgets';
import { decrementFreePoolRemaining } from '@/lib/ai/control/freePool';
import {
  assertDispatchLockClaimable,
  claimDispatchLock,
  releaseDispatchLock,
  waitForDispatchLock,
  watchAbortReleaseDispatchLock,
} from '@/lib/ai/control/dispatchLock';
import { aiTransaction } from '@/lib/ai/control/transaction';
import { classifyProbeFailure } from '@/lib/ai/probeDiagnostics';
import { isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { runIdeToolLoop, type ExtraToolSet } from '@/lib/ai/tools/runToolLoop';
import type { IdeToolProfile } from '@/lib/ai/tools/definitions';
import { imageSearch, webSearch } from '@/lib/ai/tools/webSearch';
import {
  formatImageSearchContext,
  formatResearchResultContext,
  looksLikeImageSearchQuery,
  looksLikeProjectInternalQuery,
  looksLikeWebLookupQuery,
  resolveAssistSearchQuery,
  userTextWithBrowseContext,
  userTextWithRepoContext,
} from '@/lib/ai/tools/serverBrowseAssist';
import { imageHitsToArtifacts, mergeImageArtifacts } from '@/lib/ai/tools/imageSearchArtifacts';
import { formatRepoAssistContext, gatherRepoAssistContext } from '@/lib/ai/tools/serverRepoAssist';
import { estimateCostMicros } from '@/lib/ai/pricing/modelRates';
import { AiBudget, AiRun, AiRunEvent } from '@/lib/models/AiControl';
import type { TeamChatTurn } from '@/lib/ai/teamChat';
import type { ToolArtifact } from '@/lib/ai/tools/executeTool';

const LOCK_MS = 180000;

export function budgetContextMessages<T extends { role: string; content?: string }>(
  messages: T[],
  maxTotalChars = 48000,
  maxSingleMessageChars = 32000
): T[] {
  const budgeted = messages.map((m) => {
    if (!m.content || m.content.length <= maxSingleMessageChars) return m;
    return { ...m, content: m.content.slice(0, maxSingleMessageChars) };
  });

  let total = budgeted.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  if (total <= maxTotalChars) return budgeted;

  for (let i = 1; i < budgeted.length - 1 && total > maxTotalChars; i++) {
    const m = budgeted[i];
    if (m.content && m.content.length > 500) {
      const excess = total - maxTotalChars;
      const reduceBy = Math.min(excess, m.content.length - 500);
      budgeted[i] = { ...m, content: m.content.slice(0, m.content.length - reduceBy) };
      total -= reduceBy;
    }
  }

  if (total > maxTotalChars && budgeted.length > 0) {
    const lastIdx = budgeted.length - 1;
    const lastMsg = budgeted[lastIdx];
    if (lastMsg.content) {
      const excess = total - maxTotalChars;
      budgeted[lastIdx] = { ...lastMsg, content: lastMsg.content.slice(0, Math.max(0, lastMsg.content.length - excess)) };
    }
  }

  return budgeted;
}

function settleChatCostMicros(input: {
  noProviderFee: boolean;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): number | null {
  if (input.noProviderFee) return 0;
  return estimateCostMicros({
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  });
}

function statusTurn(
  text: string,
  failureCategory: string,
  runId?: string,
  cost?: {
    costMicros?: number | null;
    reservedMicros?: number | null;
    noProviderFee?: boolean;
    debugHint?: string;
  }
): TeamChatTurn {
  return {
    requestId: randomUUID(),
    role: 'status',
    text,
    failureCategory,
    ...(runId ? { runId } : {}),
    ...(cost?.costMicros !== undefined ? { costMicros: cost.costMicros } : {}),
    ...(cost?.reservedMicros !== undefined ? { reservedMicros: cost.reservedMicros } : {}),
    ...(cost?.noProviderFee !== undefined ? { noProviderFee: cost.noProviderFee } : {}),
    ...(cost?.debugHint ? { debugHint: cost.debugHint.slice(0, 400) } : {}),
  };
}

function appendArtifacts(text: string, artifacts: ToolArtifact[]): string {
  if (!artifacts.length) return text;
  // Search/browse screenshots are shown only via turn.artifacts UI — do not inject
  // markdown list lines (those become orphan captions / broken-image noise).
  const generated = artifacts.filter((item) => !item.assetId.startsWith('imgsearch:'));
  if (!generated.length) return text;
  const safe = generated.map((item) => `- Generated image: ${item.name} (asset ${item.assetId})`);
  return `${text}\n\n${safe.join('\n')}`.slice(0, 8000);
}

const TOOL_NEEDY =
  /\b(image|photo|picture|generate|draw|screenshot|browse|fetch|navigate|web[_ ]?search|search the web|image[_ ]?search)\b/i;

function looksLikeToolNeedyQuery(text: string): boolean {
  return TOOL_NEEDY.test(text.trim());
}

type ChatPhase =
  | 'proactive_browse'
  | 'repo_assist'
  | 'plain_first'
  | 'tool_loop'
  | 'browse_assist_retry'
  | 'plain_retry'
  | 'length_retry'
  | 'empty_content';

function formatDebugHint(parts: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')
    .slice(0, 400);
}

function gatewayDebugParts(error: unknown): Record<string, string | number | boolean | null | undefined> {
  if (!(error instanceof GatewayError)) {
    return { err: error instanceof Error ? error.name : 'unknown' };
  }
  const details = error.details;
  return {
    code: error.code,
    kind: details?.kind,
    httpStatus: details?.httpStatus,
    finishReason: details?.finishReason,
    contentChars: details?.contentChars,
    hasToolCalls: details?.hasToolCalls,
    hasReasoning: details?.hasReasoning,
    providerMessage: details?.providerMessage,
  };
}

import { companyChatAdmissionMessage } from '@/lib/ai/companyChatAdmission';
import { recordModelFailure, recordModelSuccess } from '@/lib/ai/engine/health';
import { describeToolCall, type ProgressFn } from '@/lib/ai/progress';
import { contextBudgetChars, contextWindowFor } from '@/lib/ai/engine/catalog';

/**
 * Governed IDE chat via a company credential (Direct or AI Team Worker binding).
 * Runs the image/browse tool loop when the host supports tools.
 */
export async function attemptCompanyCredentialChat(input: {
  systemPrompt: string;
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  userText: string;
  priorTurns: { role: 'user' | 'assistant' | 'status'; text: string }[];
  modelProfileId: string;
  model: string;
  includeImageTool?: boolean;
  projectName?: string;
  /** When false, omit GitHub repo tools (Free Chat). Default true. */
  includeRepoTools?: boolean;
  /** Restrict tool catalog. Plan mode should use `repo`. */
  toolProfile?: IdeToolProfile;
  /** Skip tools (e.g. forced plain completion). */
  forcePlain?: boolean;
  /** Free credentials: skip plain_first and run the tool loop (orchestra dig stages). */
  forceToolLoop?: boolean;
  /** Pre-fetched repo dig from orchestra; skips proactive tryRepoAssistPlain. */
  repoContextBlock?: string;
  /**
   * Raise completion budget (Plan/Build drafts). Hard-capped in this function.
   * Paid hosts also take max(policy.maxOutputTokens, this) so low Admin defaults
   * cannot clip long-form plan output to empty finishReason=length replies.
   */
  maxOutputTokensOverride?: number;
  stopOnUpstreamFailure?: boolean;
  signal?: AbortSignal;
  /** Live progress: each tool call, described for a person. */
  onProgress?: ProgressFn;
  /** Caller-scoped tools (company capabilities). Presence always selects the tool loop. */
  extraTools?: ExtraToolSet;
}): Promise<TeamChatTurn> {
  let gateway: GatewayConfiguration;
  let profile: Awaited<ReturnType<typeof gatewayFromModelProfile>>['profile'];
  try {
    ({ gateway, profile } = await gatewayFromModelProfile(input.modelProfileId, input.model));
  } catch (error) {
    if (error instanceof GatewayError) {
      return statusTurn('Company credential or model id is unavailable.', error.code);
    }
    return statusTurn('Company credential or model id is unavailable.', 'configuration');
  }

  const freeCredential = isFreeCredential({ provider: profile.provider, tier: profile.tier });
  const lockToken = randomUUID();
  let runId: Types.ObjectId;
  let policy: Awaited<ReturnType<typeof getPipelineInferencePolicy>>;
  let reservationMicros = 0;

  try {
    // The shared lock protects the shared free/local model (one request at a time). Paid providers
    // take many requests at once, so they skip it. Free calls wait their turn instead of failing.
    if (freeCredential) await waitForDispatchLock({ signal: input.signal });
    const admitted = await aiTransaction(async (session) => {
      policy = await getPipelineInferencePolicy(
        input.organizationId,
        String(input.projectId),
        session,
        { requirePositiveReservation: !freeCredential }
      );
      reservationMicros = freeCredential ? 0 : policy.reservationMicros;
      const now = new Date();
      if (freeCredential) await assertDispatchLockClaimable(now, session);
      // Company credentials call the org's own provider (OpenAI, local host, etc.).
      // Do not consume platform shared remote spacing/daily counters meant for the Nucleas shared endpoint.

      const [run] = await AiRun.create(
        [
          {
            organizationId: input.organizationId,
            projectId: input.projectId,
            role: 'architect',
            status: 'queued',
            createdByUserId: new Types.ObjectId(input.userId),
            inputDigest: digestValue(input.userText.slice(0, 6000)),
            policyDigest: policy.digest,
            model: gateway.model,
          },
        ],
        { session }
      );

      if (freeCredential) {
        await claimDispatchLock({
          token: lockToken,
          expiresAt: new Date(now.getTime() + LOCK_MS),
          runId: run._id,
          session,
        });
      }

      if (reservationMicros > 0) {
        const period = now.toISOString().slice(0, 7);
        const budgetIds: Types.ObjectId[] = [];
        for (const [scopeKey, limitMicros] of [
          ['organization', policy.organizationLimitMicros],
          [`project:${String(input.projectId)}`, policy.projectLimitMicros],
        ] as const) {
          const budget = await AiBudget.findOneAndUpdate(
            { organizationId: input.organizationId, scopeKey, period },
            { $set: { limitMicros }, $setOnInsert: { spentMicros: 0, reservedMicros: 0 } },
            { session, upsert: true, new: true, runValidators: true }
          );
          budgetIds.push(budget._id);
        }
        await reserveRunBudget(input.organizationId, run._id, budgetIds, reservationMicros, session);
      }
      await AiRun.updateOne(
        { _id: run._id },
        { $set: { status: 'running', startedAt: now }, $inc: { revision: 1 } },
        { session }
      );
      return { runId: run._id, policy, reservationMicros };
    });
    runId = admitted.runId;
    policy = admitted.policy;
    reservationMicros = admitted.reservationMicros;
  } catch (error) {
    await releaseDispatchLock(lockToken);
    if (error instanceof GatewayError) {
      return statusTurn(companyChatAdmissionMessage(error.code), error.code);
    }
    return statusTurn(
      freeCredential
        ? 'Enable Remote connection and Processing in Admin → AI Settings before free/local chat can run.'
        : 'Paid chat needs processing enabled and a positive reservation within budget ceilings.',
      'unavailable'
    );
  }

  // Company credentials: only free/local are truly no-fee. Platform Admin "no provider fee"
  // applies to the shared remote endpoint, not org OpenAI/Anthropic keys.
  const noProviderFee = freeCredential;
  const stopWatchingAbort = watchAbortReleaseDispatchLock(input.signal, lockToken);

  async function finish(args: {
    actualMicros: number | null;
    status: 'completed' | 'blocked';
    summary: string;
    failureCode?: string;
    result?: { inputTokens?: number | null; outputTokens?: number | null; latencyMs?: number | null };
  }) {
    try {
      await aiTransaction(async (session) => {
        await settleRunBudget(input.organizationId, runId, args.actualMicros, session);
        if (noProviderFee && reservationMicros > 0) {
          await decrementFreePoolRemaining(reservationMicros, session);
        }
        const run = await AiRun.findOneAndUpdate(
          { _id: runId, organizationId: input.organizationId, projectId: input.projectId },
          {
            $set: {
              status: args.status,
              completedAt: new Date(),
              ...(args.failureCode ? { failureCode: args.failureCode } : {}),
              ...(args.result?.inputTokens != null ? { inputTokens: args.result.inputTokens } : {}),
              ...(args.result?.outputTokens != null ? { outputTokens: args.result.outputTokens } : {}),
              ...(args.result?.latencyMs != null ? { latencyMs: args.result.latencyMs } : {}),
              ...(args.actualMicros !== null ? { costMicros: args.actualMicros } : {}),
            },
            $inc: { revision: 1 },
          },
          { session, new: true }
        );
        if (run) {
          await AiRunEvent.create(
            [
              {
                organizationId: input.organizationId,
                projectId: input.projectId,
                runId: run._id,
                sequence: run.revision,
                type: `run.${args.status}`,
                summary: args.summary.slice(0, 2000),
              },
            ],
            { session }
          );
        }
      });
    } finally {
      stopWatchingAbort();
      // Always clear the shared lock, even if settle/Mongo fails mid-finish.
      await releaseDispatchLock(lockToken);
    }
  }

  if (input.signal?.aborted) {
    await finish({
      actualMicros: noProviderFee ? 0 : null,
      status: 'blocked',
      summary: 'Chat cancelled after admission.',
      failureCode: 'cancelled',
    }).catch(() => undefined);
    return statusTurn('The chat request was cancelled before completion.', 'cancelled', String(runId), {
      costMicros: noProviderFee ? 0 : null,
      reservedMicros: reservationMicros,
      noProviderFee,
    });
  }

  const history = input.priorTurns
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .slice(-8)
    .map((turn) => ({ role: turn.role as 'user' | 'assistant', content: turn.text.slice(0, 2000) }));

  // Reasoning models count reasoning tokens against max_completion_tokens; keep headroom for visible text.
  // Plan/Build need large budgets; low Admin maxOutputTokens previously clipped paid hosts to empty length finishes.
  const OUTPUT_HARD_CAP = 8192;
  const standardCap = usesMaxCompletionTokens(gateway.model) ? 8192 : 4096;
  const requestedCap = Math.min(
    OUTPUT_HARD_CAP,
    Math.max(256, input.maxOutputTokensOverride ?? standardCap)
  );
  let maxOutputTokens = freeCredential
    ? requestedCap
    : Math.min(OUTPUT_HARD_CAP, Math.max(requestedCap, policy.maxOutputTokens));
  // Prompts are sized to this model's real context window, not a fixed pilot cap.
  const contextChars = contextBudgetChars(
    await contextWindowFor(gateway.model, profile.provider, freeCredential, input.modelProfileId).catch(() => (freeCredential ? 16_000 : 64_000)),
    maxOutputTokens
  );

  try {
    let loop: Awaited<ReturnType<typeof runIdeToolLoop>> | undefined;
    let browseAssisted = false;
    let phase: ChatPhase = 'tool_loop';
    let lastError: unknown;
    const usePlain = Boolean(input.forcePlain) || input.toolProfile === 'none';
    const isImageLookup = looksLikeImageSearchQuery(input.userText);
    const projectInternal = looksLikeProjectInternalQuery(input.userText, input.projectName);
    const isLookup = !projectInternal && !isImageLookup && looksLikeWebLookupQuery(input.userText);
    const toolNeedy = looksLikeToolNeedyQuery(input.userText);
    const repoToolsOn = input.includeRepoTools !== false;
    const repoContextBlock = input.repoContextBlock?.trim() ?? '';
    const userTextForModel = repoContextBlock
      ? userTextWithRepoContext(input.userText, repoContextBlock, {
          maxChars: 30_000,
          maxUserChars: 12_000,
        })
      : input.userText;
    /**
     * Prefer the tool loop for paid hosts and project IDE (repo_*).
     * Free Chat without repo tools: Nucleas assist covers web/image digs; only force the
     * tool loop for generate/draw-style asks (toolNeedy with no assist path) or forceToolLoop.
     */
    const preferToolLoop =
      Boolean(input.forceToolLoop) ||
      Boolean(input.extraTools) ||
      (repoToolsOn && (toolNeedy || isLookup || projectInternal)) ||
      (!freeCredential && toolNeedy) ||
      (freeCredential && !repoToolsOn && toolNeedy && !isLookup && !isImageLookup);

    const priorUserTexts = input.priorTurns
      .filter((turn) => turn.role === 'user')
      .map((turn) => turn.text);
    const assistSearchQuery = resolveAssistSearchQuery(input.userText, priorUserTexts);

    async function plainInvoke(args: {
      systemExtra: string;
      userContent: string;
    }) {
      const rawMessages = [
        {
          role: 'system' as const,
          content: `${input.systemPrompt} ${args.systemExtra}`,
        },
        ...history,
        { role: 'user' as const, content: args.userContent },
      ];
      const budgeted = budgetContextMessages(rawMessages, contextChars, contextChars);
      return invokeModel(
        gateway,
        {
          role: 'architect',
          messages: budgeted as [{ role: 'system' | 'user' | 'assistant'; content: string }, ...{ role: 'system' | 'user' | 'assistant'; content: string }[]],
          maxOutputTokens,
        },
        { signal: input.signal }
      );
    }

    /** One soft retry when the free host returns 502/504 after Nucleas already gathered context. */
    async function plainInvokeAfterAssist(args: {
      systemExtra: string;
      userContent: string;
    }) {
      try {
        return await plainInvoke(args);
      } catch (error) {
        const status =
          error instanceof GatewayError ? error.details?.httpStatus : undefined;
        const retryable =
          freeCredential &&
          error instanceof GatewayError &&
          error.code === 'unavailable' &&
          (status === 502 || status === 504);
        if (!retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800));
        return plainInvoke(args);
      }
    }

    async function tryBrowseAssistPlain(systemExtra: string): Promise<{
      content: string;
      toolCallsMade: string[];
      artifacts: ToolArtifact[];
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number;
    } | null> {
      if (!freeCredential || !isLookup) return null;
      // Project IDE has repo tools — let the tool loop choose repo_* vs web.
      if (input.includeRepoTools !== false) return null;
      const [search, images] = await Promise.all([
        webSearch(assistSearchQuery, {
          signal: input.signal,
          depth: 'deep',
          organizationId: input.organizationId,
        }),
        imageSearch(assistSearchQuery, {
          signal: input.signal,
          organizationId: input.organizationId,
        }),
      ]);
      browseAssisted = true;
      const toolsUsed = search.toolsUsed?.length ? [...search.toolsUsed] : ['web_search'];
      if (!toolsUsed.includes('image_search')) toolsUsed.push('image_search');
      const mergedImages = [
        ...images.hits,
        ...(search.pageImages ?? []),
      ];
      const imageBlock =
        mergedImages.length > 0
          ? formatImageSearchContext({
              ...images,
              hits: mergedImages.slice(0, 8),
              hitCount: Math.min(mergedImages.length, 8),
              note:
                images.hitCount > 0
                  ? images.note
                  : `Found ${Math.min(mergedImages.length, 8)} image(s) from page renders / image search.`,
            })
          : formatImageSearchContext(images);
      const block = `${formatResearchResultContext(search)}\n\n${imageBlock}`.slice(0, 10000);
      const artifacts = mergeImageArtifacts(
        imageHitsToArtifacts(images.hits),
        imageHitsToArtifacts(search.pageImages ?? [])
      );
      const plain = await plainInvokeAfterAssist({
        systemExtra: `${systemExtra} Answer directly in clear markdown (headings, bullet lists, [links](url)). Do not call tools. Do not use markdown image syntax (![alt](url))—screenshots render only as attached UI thumbnails. Nucleas already ran a full research stack (${toolsUsed.join(', ')}): search, page fetch, and image discovery${toolsUsed.includes('browser_navigate') ? ' plus Playwright page render' : ''}. Summarize those sources—never say you cannot browse, that tools were unavailable, or that no images were found when image results or thumbnails are present. Prefer compact facts and clickable source links.`,
        userContent: userTextWithBrowseContext(input.userText, block),
      });
      return {
        content: plain.content,
        toolCallsMade: toolsUsed,
        artifacts,
        inputTokens: plain.inputTokens,
        outputTokens: plain.outputTokens,
        latencyMs: plain.latencyMs,
      };
    }

    async function tryImageAssistPlain(systemExtra: string): Promise<{
      content: string;
      toolCallsMade: string[];
      artifacts: ToolArtifact[];
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number;
    } | null> {
      if (!freeCredential || !isImageLookup) return null;
      const search = await imageSearch(assistSearchQuery, {
        signal: input.signal,
        organizationId: input.organizationId,
      });
      browseAssisted = true;
      const toolsUsed = search.toolsUsed?.length ? search.toolsUsed : ['image_search'];
      const block = formatImageSearchContext(search);
      const artifacts = imageHitsToArtifacts(search.hits);
      const plain = await plainInvokeAfterAssist({
        systemExtra: `${systemExtra} Answer directly in clear markdown. Do not call tools. Do not use markdown image syntax (![alt](url))—thumbnails are attached in the UI. Nucleas already ran image_search; you may mention image page/source links as normal [links](url). Never invent URLs or claim no images if results/artifacts exist.`,
        userContent: userTextWithBrowseContext(input.userText, block),
      });
      return {
        content: plain.content,
        toolCallsMade: toolsUsed,
        artifacts,
        inputTokens: plain.inputTokens,
        outputTokens: plain.outputTokens,
        latencyMs: plain.latencyMs,
      };
    }

    async function tryRepoAssistPlain(systemExtra: string): Promise<{
      content: string;
      toolCallsMade: string[];
      artifacts: ToolArtifact[];
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number;
    } | null> {
      if (!repoToolsOn) return null;
      if (!projectInternal && !input.forceToolLoop) return null;
      phase = 'repo_assist';
      const dig = await gatherRepoAssistContext({
        organizationId: input.organizationId,
        projectId: input.projectId,
        userText: input.userText,
      });
      browseAssisted = true;
      const plain = await plainInvokeAfterAssist({
        systemExtra: `${systemExtra} Answer directly. Do not call tools. Nucleas already ran repo_tree/repo_read; ground your answer in the provided repository dig. Do not claim tools failed. If the dig says the repo is unbound, tell the user to bind GitHub / connect the GitHub App.`,
        userContent: userTextWithRepoContext(input.userText, formatRepoAssistContext(dig), {
          maxChars: 30_000,
        }),
      });
      return {
        content: plain.content,
        toolCallsMade: dig.toolsUsed.length ? dig.toolsUsed : ['repo_tree'],
        artifacts: [],
        inputTokens: plain.inputTokens,
        outputTokens: plain.outputTokens,
        latencyMs: plain.latencyMs,
      };
    }

    function isEmptyLengthToolFailure(error: unknown): boolean {
      if (!(error instanceof GatewayError) || error.code !== 'invalid_response') return false;
      const kind = error.details?.kind;
      const finishReason = error.details?.finishReason;
      return kind === 'empty_content' || finishReason === 'length';
    }

    /** One retry with a larger completion budget when the host returns empty + finish_reason=length. */
    async function retryPlainAfterLengthLimit(systemExtra: string): Promise<{
      content: string;
      toolCallsMade: string[];
      artifacts: ToolArtifact[];
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number;
    }> {
      phase = 'length_retry';
      maxOutputTokens = Math.min(OUTPUT_HARD_CAP, Math.max(maxOutputTokens * 2, 4096));
      const plain = await plainInvoke({
        systemExtra: `${systemExtra} The previous attempt hit the output token limit before any visible text. Finish the full answer now in one shot. Do not call tools.`,
        userContent: userTextForModel,
      });
      return {
        content: plain.content,
        toolCallsMade: [],
        artifacts: [],
        inputTokens: plain.inputTokens,
        outputTokens: plain.outputTokens,
        latencyMs: plain.latencyMs,
      };
    }

    async function runToolLoopPhase() {
      phase = 'tool_loop';
      const deepRepo =
        repoToolsOn && (projectInternal || Boolean(input.forceToolLoop) || Boolean(repoContextBlock));
      const rawMessages = [
        { role: 'system' as const, content: input.systemPrompt },
        ...history,
        { role: 'user' as const, content: userTextForModel },
      ];
      const budgeted = budgetContextMessages(rawMessages, contextChars, contextChars);
      return runIdeToolLoop({
        gateway,
        messages: budgeted,
        contextChars,
        maxOutputTokens,
        includeImageTool: input.includeImageTool !== false,
        includeRepoTools: input.includeRepoTools !== false,
        toolProfile: input.toolProfile ?? 'full',
        maxRounds: deepRepo ? 32 : input.extraTools ? 10 : undefined,
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        runId,
        signal: input.signal,
        extraTools: input.extraTools,
        onToolCall: input.onProgress ? (name, argsJson) => input.onProgress!(describeToolCall(name, argsJson)) : undefined,
      });
    }

    if (usePlain) {
      phase = 'plain_first';
      try {
        const plain = await plainInvoke({
          systemExtra: 'Tools are disabled for this turn; answer from knowledge only. Do not call tools.',
          userContent: userTextForModel,
        });
        loop = {
          content: plain.content,
          toolCallsMade: [],
          artifacts: [],
          inputTokens: plain.inputTokens,
          outputTokens: plain.outputTokens,
          latencyMs: plain.latencyMs,
        };
      } catch (plainError) {
        lastError = plainError;
        if (isEmptyLengthToolFailure(plainError)) {
          try {
            loop = await retryPlainAfterLengthLimit(
              'Tools are disabled for this turn; answer from knowledge only.'
            );
          } catch (retryError) {
            lastError = retryError;
            throw retryError;
          }
        } else {
          const retryBrowse =
            freeCredential &&
            (plainError instanceof GatewayError
              ? plainError.code === 'unavailable' || plainError.code === 'invalid_response'
              : isLookup || isImageLookup);
          if (!retryBrowse) throw plainError;
          phase = 'browse_assist_retry';
          const assisted =
            (await tryImageAssistPlain('Tools are disabled for this turn.')) ??
            (await tryBrowseAssistPlain('Tools are disabled for this turn.'));
          if (!assisted) throw plainError;
          loop = assisted;
        }
      }
    } else if (freeCredential) {
      let resolved = false;

      if (isImageLookup) {
        phase = 'proactive_browse';
        try {
          const assisted = await tryImageAssistPlain(
            'Prefer Nucleas image_search for finding existing web images.'
          );
          if (assisted) {
            loop = assisted;
            resolved = true;
          }
        } catch (browseError) {
          lastError = browseError;
        }
      }

      if (!resolved && isLookup) {
        phase = 'proactive_browse';
        try {
          const assisted = await tryBrowseAssistPlain(
            'Prefer Nucleas web_search for this factual lookup.'
          );
          if (assisted) {
            loop = assisted;
            resolved = true;
          }
        } catch (browseError) {
          lastError = browseError;
          // Fall through to plain / tools; never surface raw search errors alone.
        }
      }

      if (
        !resolved &&
        !repoContextBlock &&
        (projectInternal || Boolean(input.forceToolLoop)) &&
        repoToolsOn
      ) {
        try {
          const assisted = await tryRepoAssistPlain(
            'Prefer Nucleas repo dig for this project-internal question.'
          );
          if (assisted) {
            loop = assisted;
            resolved = true;
          }
        } catch (repoError) {
          lastError = repoError;
        }
      }

      if (!resolved && !preferToolLoop) {
        phase = 'plain_first';
        try {
          const plain = await plainInvoke({
            systemExtra: 'Answer directly and briefly. Do not call tools.',
            userContent: userTextForModel,
          });
          loop = {
            content: plain.content,
            toolCallsMade: [],
            artifacts: [],
            inputTokens: plain.inputTokens,
            outputTokens: plain.outputTokens,
            latencyMs: plain.latencyMs,
          };
          resolved = true;
        } catch (plainError) {
          lastError = plainError;
        }
      }

      if (!resolved && (preferToolLoop || !loop)) {
        try {
          loop = await runToolLoopPhase();
          resolved = true;
        } catch (toolError) {
          lastError = toolError;
          const isUnsupportedToolHost =
            freeCredential &&
            toolError instanceof GatewayError &&
            (toolError.details?.httpStatus === 400 || toolError.code === 'invalid_response');
          if (input.stopOnUpstreamFailure && !isUnsupportedToolHost) throw toolError;
          phase = 'browse_assist_retry';
          let assisted: Awaited<ReturnType<typeof tryBrowseAssistPlain>> = null;
          try {
            assisted =
              (repoContextBlock
                ? null
                : await tryRepoAssistPlain(
                    'Nucleas already inspected the repository; answer from the dig results. Do not claim tools failed.'
                  )) ??
              (await tryImageAssistPlain(
                'Nucleas already gathered image results; answer from them. Do not claim tools failed.'
              )) ??
              (await tryBrowseAssistPlain(
                'Nucleas already gathered web research; answer from it. Do not claim tools failed.'
              ));
          } catch (assistError) {
            lastError = isEmptyLengthToolFailure(toolError) ? toolError : assistError;
            assisted = null;
          }
          if (assisted) {
            loop = assisted;
            resolved = true;
          } else {
            phase = 'plain_retry';
            try {
              const plain = await plainInvoke({
                systemExtra:
                  projectInternal || browseAssisted
                    ? 'Could not read the repository this turn; say what blocked it if known. Do not invent file contents. Do not call tools.'
                    : 'Could not complete tools this turn; answer carefully without inventing repo file contents. Do not call tools.',
                userContent: userTextForModel,
              });
              loop = {
                content: plain.content,
                toolCallsMade: [],
                artifacts: [],
                inputTokens: plain.inputTokens,
                outputTokens: plain.outputTokens,
                latencyMs: plain.latencyMs,
              };
              resolved = true;
            } catch (plainError) {
              lastError = plainError;
              if (isEmptyLengthToolFailure(plainError) || isEmptyLengthToolFailure(toolError)) {
                try {
                  loop = await retryPlainAfterLengthLimit(
                    'Write the complete answer from context you have. Do not invent missing file contents. Do not call tools.'
                  );
                  resolved = true;
                } catch (retryError) {
                  lastError = retryError;
                  throw retryError;
                }
              } else {
                // Preserve authentication, rate-limit, HTTP, and transport failures.
                // No assist result does not mean that web search failed (project
                // chat intentionally skips web assist).
                throw plainError;
              }
            }
          }
        }
      }

      if (!resolved || !loop) {
        throw lastError instanceof Error
          ? lastError
          : new GatewayError('invalid_response', { kind: 'unresolved' });
      }
    } else {
      try {
        loop = await runToolLoopPhase();
      } catch (toolError) {
        lastError = toolError;
        if (input.stopOnUpstreamFailure) throw toolError;
        const retryableGateway =
          toolError instanceof GatewayError &&
          (toolError.code === 'unavailable' || toolError.code === 'invalid_response');
        if (!retryableGateway) throw toolError;
        phase = 'browse_assist_retry';
        let assisted: Awaited<ReturnType<typeof tryRepoAssistPlain>> = null;
        try {
          assisted = repoContextBlock
            ? null
            : await tryRepoAssistPlain(
                'Nucleas already inspected the repository; answer from the dig results. Do not claim tools failed.'
              );
        } catch (assistError) {
          lastError = assistError;
          assisted = null;
        }
        if (assisted) {
          loop = assisted;
        } else if (isEmptyLengthToolFailure(toolError)) {
          loop = await retryPlainAfterLengthLimit(
            projectInternal
              ? 'Write the complete answer from repository context you have. Do not invent file contents. Do not call tools.'
              : 'Write the complete answer carefully. Do not invent repo file contents. Do not call tools.'
          );
        } else {
          phase = 'plain_retry';
          try {
            const plain = await plainInvoke({
              systemExtra: projectInternal
                ? 'Could not read the repository this turn; say what blocked it if known. Do not invent file contents. Do not call tools.'
                : 'Could not complete tools this turn; answer carefully without inventing repo file contents. Do not call tools.',
              userContent: userTextForModel,
            });
            loop = {
              content: plain.content,
              toolCallsMade: [],
              artifacts: [],
              inputTokens: plain.inputTokens,
              outputTokens: plain.outputTokens,
              latencyMs: plain.latencyMs,
            };
          } catch (plainError) {
            if (isEmptyLengthToolFailure(plainError)) {
              loop = await retryPlainAfterLengthLimit(
                'Write the complete answer now. Do not call tools.'
              );
            } else {
              throw plainError;
            }
          }
        }
      }
    }

    if (!loop) {
      throw new GatewayError('invalid_response', { kind: 'unresolved', contentChars: 0 });
    }

    const content = appendArtifacts(loop.content, loop.artifacts).trim();
    if (!content) {
      phase = 'empty_content';
      const hint = formatDebugHint({
        phase,
        browseAssisted,
        contentChars: 0,
        tools: loop.toolCallsMade.join(',') || 'none',
      });
      await finish({
        actualMicros: settleChatCostMicros({
          noProviderFee,
          model: gateway.model,
          inputTokens: loop.inputTokens,
          outputTokens: loop.outputTokens,
        }),
        status: 'blocked',
        summary: `Model returned empty chat content. ${hint}`.slice(0, 500),
        failureCode: 'invalid_response',
        result: loop,
      });
      return statusTurn(
        browseAssisted
          ? 'Browse ran on Nucleas but the model returned no usable text. Check that the model id is loaded and the endpoint accepts plain chat requests.'
          : 'The model returned an empty reply. No assistant content was stored.',
        'invalid_response',
        String(runId),
        {
          costMicros: settleChatCostMicros({
            noProviderFee,
            model: gateway.model,
            inputTokens: loop.inputTokens,
            outputTokens: loop.outputTokens,
          }),
          reservedMicros: reservationMicros,
          noProviderFee,
          debugHint: hint,
        }
      );
    }

    const settled = settleChatCostMicros({
      noProviderFee,
      model: gateway.model,
      inputTokens: loop.inputTokens,
      outputTokens: loop.outputTokens,
    });
    await finish({
      actualMicros: settled,
      status: 'completed',
      summary: `Chat completed${loop.toolCallsMade.length ? ` with tools: ${loop.toolCallsMade.join(',')}` : ''}${browseAssisted ? ' (Nucleas browse assist)' : ''} phase=${phase}.`.slice(
        0,
        500
      ),
      result: loop,
    });
    // A working call clears any bench on this credential or model.
    void recordModelSuccess(input.modelProfileId, gateway.model).catch(() => undefined);
    return {
      requestId: randomUUID(),
      role: 'assistant',
      text: content,
      runId: String(runId),
      costMicros: settled,
      reservedMicros: reservationMicros,
      noProviderFee,
      artifacts: loop.artifacts,
      toolsUsed: loop.toolCallsMade,
    };
  } catch (error) {
    const errorUsage = (error as { usage?: { inputTokens?: number; outputTokens?: number } })?.usage;
    const failureCode = error instanceof GatewayError ? error.code : classifyProbeFailure(error);
    const hint = formatDebugHint({
      phase: 'failed',
      ...gatewayDebugParts(error),
      probe: failureCode,
    });
    const errorCost = noProviderFee
      ? 0
      : errorUsage
      ? settleChatCostMicros({
          noProviderFee,
          model: gateway.model,
          inputTokens: errorUsage.inputTokens,
          outputTokens: errorUsage.outputTokens,
        })
      : null;
    await finish({
      actualMicros: errorCost,
      status: 'blocked',
      summary: `Chat model/tool call failed after admission. ${hint}`.slice(0, 500),
      failureCode,
    }).catch(() => undefined);

    if (error instanceof GatewayError) {
      // Rejected keys, unpaid accounts and refused models are benched so selection picks elsewhere.
      await recordModelFailure({
        profileId: input.modelProfileId,
        model: gateway.model,
        httpStatus: error.details?.httpStatus,
        message: error.details?.providerMessage,
      }).catch(() => undefined);
      if (error.details?.httpStatus === 504) {
        return statusTurn(
          'HTTP 504 (upstream timeout): The upstream model gateway timed out. Please try again.',
          error.code,
          String(runId),
          {
            costMicros: errorCost,
            reservedMicros: reservationMicros,
            noProviderFee,
            debugHint: hint,
          }
        );
      }
      const messagesByCode: Record<GatewayError['code'], string> = {
        configuration: 'Inference is not configured for this chat.',
        credentials: 'Remote authentication was rejected.',
        rate_limit: 'The remote provider rate-limited this request.',
        unavailable: freeCredential
          ? error.details?.httpStatus
            ? `Local model gateway returned HTTP ${error.details.httpStatus}. Check the saved model ID and the provider/router logs for this request.`
            : 'Local model request failed before a usable response was received. See the diagnostic details below; this does not establish that web search failed.'
          : 'The remote model endpoint was unreachable or returned an error.',
        invalid_response: freeCredential
          ? error.details?.finishReason === 'length' || error.details?.kind === 'empty_content'
            ? 'The model hit its output token limit before producing text (common on long Plan drafts). Try again — Nucleas retries with a larger budget automatically.'
            : 'This free/local host returned an invalid response. Check that the model id is loaded and the endpoint accepts the request (including tools if used). Browse may have run on Nucleas without usable model text.'
          : error.details?.finishReason === 'length' || error.details?.kind === 'empty_content'
            ? 'The remote model hit its output token limit before producing text (common on long Plan drafts). Try again — Nucleas retries with a larger budget automatically.'
            : 'The remote response could not be validated.',
        cancelled: 'The chat request was cancelled before completion.',
      };
      // Say what the provider said (HTTP status and its own message) so failures are actionable.
      const providerNote = !freeCredential && error.details?.httpStatus
        ? ` ${profile.label} returned HTTP ${error.details.httpStatus}${error.details.providerMessage ? `: ${error.details.providerMessage}` : ''}.`
        : '';
      return statusTurn(`${messagesByCode[error.code]}${providerNote}`, error.code, String(runId), {
        costMicros: errorCost,
        reservedMicros: reservationMicros,
        noProviderFee,
        debugHint: hint,
      });
    }
    return statusTurn('The model call failed.', failureCode, String(runId), {
      costMicros: errorCost,
      reservedMicros: reservationMicros,
      noProviderFee,
      debugHint: hint,
    });
  }
}
