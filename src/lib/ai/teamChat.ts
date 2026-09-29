import 'server-only';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { getPipelineInferencePolicy } from '@/lib/ai/control/config';
import { readSettings, platformSettingsId } from '@/lib/ai/control/settings';
import { defaultPlatformAiSettings, platformAiSettingsSchema } from '@/lib/ai/settingsSchema';
import { attemptCompanyCredentialChat } from '@/lib/ai/companyChat';
import type { IdeInteractionMode, IdePlanDocument } from '@/lib/ide/idePlan';
import type { IdeChatStageCallback } from '@/lib/ide/ideChatStream';
import { withStage } from '@/lib/ide/ideChatStream';
import {
  orchestraStagePrompt,
  shouldForcePlainChat,
  toolProfileForOrchestraStage,
} from '@/lib/ide/planModePrompt';
import { parseNucleasPlan } from '@/lib/ide/parseNucleasPlan';
import { parseReviewerGate } from '@/lib/ide/parseReviewerGate';
import { looksLikeProjectInternalQuery } from '@/lib/ai/tools/serverBrowseAssist';
import { gatherRepoAssistContext } from '@/lib/ai/tools/serverRepoAssist';
import { AiObjective, AiRun } from '@/lib/models/AiControl';
import { contextBudgetChars, listAvailableModels, outputBudgetTokens } from '@/lib/ai/engine/catalog';
import { readEngineSettings, selectModel, type CostLevel, type Need } from '@/lib/ai/engine/select';
import { executeInRemoteSandbox } from '@/lib/ai/executionWorkerClient';
import { gatewayFromModelProfile } from '@/lib/ai/rolePipeline/profiles';
import { getRepoSnapshot } from '@/lib/ai/repo/snapshot';
import { projectGuide } from '@/lib/ai/repo/projectGuide';
import { shortModel, type ProgressFn } from '@/lib/ai/progress';
import { dedupeEvidenceReceipts, type RepositoryEvidenceReceipt } from '@/lib/ai/evidenceReceipts';
import {
  type TeamContextSummary,
  type TeamMessageRole,
} from '@/lib/ai/teamWorkspace';

/** How the builder should work in its disposable repository (it can run git, node and npm). */
export const BUILD_METHOD = [
  'How to work: first read the project instructions (CLAUDE.md, AGENTS.md, README) if present.',
  'Find code with run_command ["git","grep","-n","<text>"] instead of guessing paths; read the files you will change and their callers before editing.',
  'Follow the existing patterns, naming and style; keep the change minimal and focused on the plan.',
  'Verify with the project\'s own scripts from package.json (typecheck, lint, tests) and fix what you broke; report anything you could not verify.',
].join(' ');

export type TeamChatTurn = {
  requestId: string;
  role: TeamMessageRole;
  text: string;
  failureCategory?: string;
  /** Compact safe diagnostic for status turns (no secrets). */
  debugHint?: string;
  runId?: string;
  /** Settled cost when known; null when usage unknown after a paid run. */
  costMicros?: number | null;
  /** Admission reservation amount for honest reserved-cost UI. */
  reservedMicros?: number | null;
  noProviderFee?: boolean;
  artifacts?: { kind: 'image'; assetId: string; name: string; url: string }[];
  toolsUsed?: string[];
  /** Exact repository excerpts used to ground this answer, identified by revision and digest. */
  evidenceReceipts?: RepositoryEvidenceReceipt[];
  plan?: IdePlanDocument;
};

type StageBinding = { profileId: string; model: string };

/** The provider turned the request away because of the account, not the request (401/402/403). */
function providerRefused(turn: TeamChatTurn): boolean {
  return turn.failureCategory === 'credentials' || /httpStatus=(401|402|403)\b/.test(turn.debugHint ?? '');
}

/** A different model may still work when one deployment times out, rate-limits, or returns 5xx. */
function retryableProviderFailure(turn: TeamChatTurn): boolean {
  if (turn.role !== 'status') return false;
  return (
    providerRefused(turn) ||
    turn.failureCategory === 'rate_limit' ||
    turn.failureCategory === 'unavailable' ||
    /httpStatus=(429|5\d\d)\b|kind=(timeout|transport)\b/.test(turn.debugHint ?? '')
  );
}

/** A bare LiteLLM 500 can be caused by context/tool payloads or by the deployment itself. */
function shouldTryCompactRecovery(turn: TeamChatTurn): boolean {
  if (turn.role !== 'status' || !/httpStatus=500\b/.test(turn.debugHint ?? '')) return false;
  // A known routing/configuration rejection cannot be repaired by shrinking the request.
  return !/(model (?:not found|not loaded|does not exist)|unknown model|invalid model)/i.test(
    `${turn.text} ${turn.debugHint ?? ''}`
  );
}

/** What kind of work the request is: building, planning or repo questions are code; the rest is research. */
function workNeedFor(interactionMode: IdeInteractionMode, userText: string): Need {
  if (interactionMode !== 'chat' || looksLikeProjectInternalQuery(userText)) return 'code';
  return 'research';
}

function binding(choice: { profileId: string; model: string } | null): StageBinding | null {
  return choice ? { profileId: choice.profileId, model: choice.model } : null;
}

function mergeTurnCosts(turns: TeamChatTurn[]): {
  costMicros: number | null;
  reservedMicros: number;
  noProviderFee: boolean;
  toolsUsed: string[];
  artifacts: NonNullable<TeamChatTurn['artifacts']>;
  evidenceReceipts: RepositoryEvidenceReceipt[];
} {
  let costMicros: number | null = 0;
  let reservedMicros = 0;
  let noProviderFee = true;
  const toolsUsed: string[] = [];
  const artifacts: NonNullable<TeamChatTurn['artifacts']> = [];
  const evidenceReceipts: RepositoryEvidenceReceipt[] = [];
  for (const turn of turns) {
    if (costMicros != null) {
      if (turn.costMicros == null) costMicros = null;
      else costMicros += turn.costMicros;
    }
    reservedMicros += turn.reservedMicros ?? 0;
    noProviderFee = Boolean(noProviderFee && turn.noProviderFee);
    for (const tool of turn.toolsUsed ?? []) {
      if (!toolsUsed.includes(tool)) toolsUsed.push(tool);
    }
    artifacts.push(...(turn.artifacts ?? []));
    evidenceReceipts.push(...(turn.evidenceReceipts ?? []));
  }
  return { costMicros, reservedMicros, noProviderFee, toolsUsed, artifacts, evidenceReceipts: dedupeEvidenceReceipts(evidenceReceipts) };
}

async function recentActivityCounts(organizationId: string, projectId: Types.ObjectId) {
  const scope = { organizationId, projectId };
  const [objectives, runs] = await Promise.all([
    AiObjective.find(scope).select('_id').sort({ createdAt: -1 }).limit(26).maxTimeMS(3000).lean(),
    AiRun.find(scope).select('_id').sort({ createdAt: -1 }).limit(26).maxTimeMS(3000).lean(),
  ]);
  return {
    recentObjectiveCount: Math.min(objectives.length, 25),
    recentRunCount: Math.min(runs.length, 25),
  };
}

function unavailableContext(
  projectName: string,
  reason: string,
  settings: { remoteEnabled: boolean; planningEnabled: boolean },
  counts: { recentObjectiveCount: number; recentRunCount: number }
): TeamContextSummary {
  return {
    projectName,
    inferenceReady: false,
    remoteEnabled: settings.remoteEnabled,
    planningEnabled: settings.planningEnabled,
    unavailableReason: reason,
    included: [
      `Project name: ${projectName}`,
      'Recent private thread turns (when available)',
      `Recent objectives in project: ${counts.recentObjectiveCount}${counts.recentObjectiveCount >= 25 ? '+' : ''}`,
      `Recent AI runs in project: ${counts.recentRunCount}${counts.recentRunCount >= 25 ? '+' : ''}`,
    ],
    ...counts,
  };
}

function statusTurn(
  text: string,
  failureCategory: string,
  runId?: string,
  cost?: { costMicros?: number | null; reservedMicros?: number | null; noProviderFee?: boolean }
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
  };
}

async function buildTeamContextSummary(
  projectName: string,
  organizationId: string,
  projectId: Types.ObjectId
): Promise<TeamContextSummary> {
  const counts = await recentActivityCounts(organizationId, projectId).catch(() => ({
    recentObjectiveCount: 0,
    recentRunCount: 0,
  }));
  const platform = await readSettings(platformSettingsId);
  const parsed = platformAiSettingsSchema.safeParse(platform.value);
  const settings = parsed.success ? parsed.data : defaultPlatformAiSettings;
  if (!parsed.success) {
    return unavailableContext(
      projectName,
      'Platform AI settings are incomplete or inconsistent.',
      { remoteEnabled: false, planningEnabled: false },
      counts
    );
  }
  if (!settings.remoteEnabled) {
    return unavailableContext(
      projectName,
      'Remote inference connection is disabled in platform AI settings.',
      settings,
      counts
    );
  }
  if (!settings.dispatchEnabled) {
    return unavailableContext(
      projectName,
      'Queued AI processing is paused. Enable processing in Admin → AI Settings before team chat can call the model.',
      settings,
      counts
    );
  }
  try {
    await getPipelineInferencePolicy(organizationId, String(projectId), undefined, {
      requirePositiveReservation: false,
    });
  } catch {
    return unavailableContext(
      projectName,
      'Budget or reservation limits prevent AI inference. Check Admin → AI Settings and project budgets.',
      settings,
      counts
    );
  }
  return {
    projectName,
    inferenceReady: true,
    remoteEnabled: settings.remoteEnabled,
    planningEnabled: settings.planningEnabled,
    unavailableReason: null,
    included: [
      `Project name: ${projectName}`,
      'Models chosen by the AI engine at the selected cost level',
      'Recent private thread turns (when available)',
      `Recent objectives in project: ${counts.recentObjectiveCount}${counts.recentObjectiveCount >= 25 ? '+' : ''}`,
      `Recent AI runs in project: ${counts.recentRunCount}${counts.recentRunCount >= 25 ? '+' : ''}`,
      'Tools: web_search, image_search, web_fetch, optional browser_navigate, image_generate when supported',
    ],
    ...counts,
  };
}

/**
 * Distill planner output for downstream worker and reviewer stages.
 * Offloads context by stripping redundant JSON fences and structuring
 * ordered verification jobs, preventing context explosion on local models.
 */
export function distillPlannerBriefing(
  plannerText: string,
  interactionMode: IdeInteractionMode
): string {
  if (interactionMode === 'plan') {
    const parsed = parseNucleasPlan(plannerText);
    if (parsed) {
      const { plan, displayText } = parsed;
      const stepLines = plan.steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');
      const cleanDetails =
        displayText && displayText !== plan.summary ? displayText.slice(0, 8000).trim() : '';
      return [
        `Plan Goal: ${plan.title}`,
        `Summary: ${plan.summary}`,
        `\nVerification Jobs / Plan Steps to Ground with Repo Tools:\n${stepLines}`,
        cleanDetails ? `\nKey Architectural Details:\n${cleanDetails}` : '',
      ]
        .filter(Boolean)
        .join('\n')
        .trim();
    }
  }

  // Fallback for non-plan or unparsed output: strip excessive fences and trim
  return plannerText.replace(/```nucleas-plan\s*[\s\S]*?```/gi, '').trim().slice(0, 8000);
}

/** Preserve accepted repository work when a small planner misses only the plan-envelope format. */
export function planFromVerifiedFallback(userText: string, plannerText: string, workerText: string): IdePlanDocument {
  const request = userText.trim().replace(/\s+/g, ' ').slice(0, 1800);
  const paths = [...new Set(workerText.match(/(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+\.(?:[cm]?[jt]sx?|json|ya?ml|py|rb|go|rs|java|md)/g) ?? [])].slice(0, 8);
  const titleBase = request.split(/[.!?](?:\s|$)/)[0]?.trim() || 'Implement the requested repository change';
  const steps = [
    paths.length
      ? `Update the verified implementation locations: ${paths.join(', ')}.`
      : 'Update the repository implementation identified by the verified Worker investigation.',
    `Apply the requested behavior exactly: ${request.slice(0, 500)}`,
    'Run the focused project checks for the affected code and confirm the old behavior no longer appears.',
  ];
  const title = titleBase.slice(0, 200);
  const summary = request.slice(0, 2000) || title;
  return {
    title,
    summary,
    steps,
    markdown: [
      `# ${title}`,
      summary,
      steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
      '## Repository-grounded findings',
      workerText.trim().slice(0, 12_000),
      plannerText.trim() ? `## Planner notes\n\n${plannerText.trim().slice(0, 6000)}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 24_000),
    status: 'ready_for_review',
  };
}

/** Keep only unmistakably low-risk conversational turns out of the premium orchestration loop. */
export function isTrivialTeamChatRequest(text: string, mode: IdeInteractionMode): boolean {
  if (mode !== 'chat') return false;
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 160) return false;
  return /^(?:hi|hello|hey|thanks|thank you|got it|okay|ok|sounds good|good morning|good afternoon|good evening)[.!?]*$/i.test(
    normalized
  );
}

/** Orchestrated IDE chat: trivial turns answered directly; otherwise Planner → Worker → Reviewer on engine-chosen models. */
export async function attemptOrchestratedIdeReply(input: {
  projectName: string;
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  userText: string;
  priorTurns: { role: TeamMessageRole; text: string }[];
  /** Optional project task rules injected into the system prompt (IDE). */
  ruleTexts?: string[];
  interactionMode?: IdeInteractionMode;
  /** Cost level for model selection; defaults to the organization's default level. */
  level?: CostLevel;
  /** Extra context from the caller, e.g. the company's recent changes. */
  contextBlock?: string;
  /** Live progress lines for the person waiting. */
  onProgress?: ProgressFn;
  /** When aborted (e.g. client Stop), cancels the gateway fetch and releases the dispatch lock. */
  signal?: AbortSignal;
  onStage?: IdeChatStageCallback;
}): Promise<TeamChatTurn> {
  const context = await buildTeamContextSummary(input.projectName, input.organizationId, input.projectId);
  if (!context.inferenceReady) {
    return statusTurn(context.unavailableReason ?? 'Inference is unavailable.', 'unavailable');
  }

  // Models come from the AI engine: planner and reviewer by the level's price ceiling, the worker by
  // what this tab does (code, research or writing).
  const interactionMode = input.interactionMode ?? 'chat';
  const [models, settings] = await Promise.all([listAvailableModels(), readEngineSettings(input.organizationId)]);
  const level = input.level ?? settings.defaultCostLevel;
  const [plannerPick, workerPick, reviewerPick] = await Promise.all(
    (['plan', workNeedFor(interactionMode, input.userText), 'review'] as Need[]).map((need) =>
      selectModel(input.organizationId, need, level, { models, settings })
    )
  );
  const plannerBinding = binding(plannerPick.primary);
  const workerBinding = binding(workerPick.primary);
  const workerFallback = binding(workerPick.fallback);
  const reviewerBinding = binding(reviewerPick.primary);

  if (!plannerBinding || !workerBinding) {
    return statusTurn('No AI model is available. Add an AI credential in Admin → AI, then retry.', 'configuration');
  }

  if (isTrivialTeamChatRequest(input.userText, interactionMode)) {
    return withStage(input.onStage, 'worker', () =>
      attemptCompanyCredentialChat({
        systemPrompt: [
          `You are the Nucleas assistant for the project "${input.projectName}".`,
          'Answer this simple conversational turn directly and briefly. Do not claim to have inspected repositories, used tools, or changed project data.',
        ].join(' '),
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        userText: input.userText,
        priorTurns: input.priorTurns.slice(-6),
        modelProfileId: workerBinding.profileId,
        model: workerBinding.model,
        includeImageTool: false,
        includeRepoTools: false,
        toolProfile: 'none',
        forcePlain: true,
        stopOnUpstreamFailure: true,
        signal: input.signal,
      })
    );
  }

  let repoContextBlock: string | undefined;
  let repoEvidenceReceipts: RepositoryEvidenceReceipt[] = [];
  // Plan and Build are repository workflows even when the user's wording does not explicitly say
  // "codebase" or "repository" (for example, "remove OpenHV from the OpenRA listing"). Always
  // prepare bounded evidence so tool-free recovery can remain grounded.
  if (interactionMode !== 'chat' || looksLikeProjectInternalQuery(input.userText)) {
    try {
      const plannerModel = models.find((model) => model.profileId === plannerBinding.profileId && model.model === plannerBinding.model);
      const plannerContextTokens = plannerModel?.contextTokens ?? (plannerPick.primary?.free ? 16_000 : 64_000);
      const plannerOutputTokens = outputBudgetTokens(plannerContextTokens, interactionMode === 'plan' || interactionMode === 'build' ? 8_192 : 4_096);
      const plannerPromptChars = contextBudgetChars(plannerContextTokens, plannerOutputTokens);
      // Repository evidence gets at most 55% of the prompt. The rest belongs to instructions,
      // history, task rules and protocol/tool schemas. Small local windows therefore get a much
      // smaller deterministic dig without spending model tokens on summarization.
      const repoBudgetChars = Math.max(4_000, Math.min(16_000, Math.floor(plannerPromptChars * 0.55)));
      const dig = await gatherRepoAssistContext({
        organizationId: input.organizationId,
        projectId: input.projectId,
        userText: input.userText,
        maxContextChars: repoBudgetChars,
        maxFiles: Math.max(2, Math.min(8, Math.floor(repoBudgetChars / 2_000))),
      });
      if (!dig.ok && dig.okReads === 0) {
        return statusTurn(
          dig.note ||
            'Repository is unavailable for this project. Bind a GitHub repository or connect the GitHub App, then retry.',
          'unavailable'
        );
      }
      if (dig.okReads === 0 && !dig.evidenceBlock.trim()) {
        return statusTurn(
          `Could not read repository files (${dig.note}). Bind GitHub or reconnect the GitHub App, then retry.`,
          'unavailable'
        );
      }
      const block = (dig.evidenceBlock || dig.contextBlock).trim();
      if (block) repoContextBlock = block.slice(0, repoBudgetChars);
      repoEvidenceReceipts = dig.evidenceReceipts ?? [];
    } catch {
      return statusTurn(
        'Repository dig failed before orchestra could start. Check GitHub bind/App connection and retry.',
        'unavailable'
      );
    }
  }

  const ruleBlock =
    input.ruleTexts && input.ruleTexts.length > 0
      ? ['Project task rules you must follow:', ...input.ruleTexts.map((rule, index) => `${index + 1}. ${rule}`)].join(
          '\n'
        )
      : null;

  // Code work follows the project's own conventions: its instruction files, scripts and layout.
  const codeWork = interactionMode !== 'chat' || looksLikeProjectInternalQuery(input.userText);
  if (codeWork) input.onProgress?.('Loading the repository');
  const snapshot = codeWork ? await getRepoSnapshot(input.organizationId, input.projectId).catch(() => null) : null;
  const guide = snapshot?.ok ? projectGuide(snapshot.snapshot) : '';

  const sharedContext = [
    `You are the Nucleas assistant for the project "${input.projectName}": you plan, research, write and code for the team.`,
    `This project has about ${context.recentObjectiveCount} recent objectives and ${context.recentRunCount} recent AI runs recorded in Nucleas.`,
    'Do not claim to have changed project data or completed tasks outside this chat.',
    'If you lack information or tools, say what is missing instead of inventing project or web facts.',
    ...(ruleBlock ? [ruleBlock] : []),
    ...(guide ? [`\n\n# Project guide (follow these conventions; use the listed scripts to verify)\n${guide}`] : []),
    ...(input.contextBlock ? [`\n\n# Recent changes for this company (newest first)\n${input.contextBlock}`] : []),
  ]
    .filter(Boolean)
    .join(' ');

  async function runStage(args: {
    stage: 'planner' | 'worker' | 'reviewer';
    binding: { profileId: string; model: string };
    userText: string;
    priorTurns: { role: TeamMessageRole; text: string }[];
  }): Promise<TeamChatTurn> {
    if (input.signal?.aborted) {
      return statusTurn('The chat request was cancelled before completion.', 'cancelled');
    }
    const toolProfile = toolProfileForOrchestraStage(args.stage, interactionMode);
    const allowTools = toolProfile !== 'none';
    const systemPrompt = [
      sharedContext,
      `Pipeline stage: ${args.stage}.`,
      orchestraStagePrompt(args.stage, interactionMode),
      allowTools
        ? 'You may call provided tools. Never claim browse, repo, or image results without tool output. If a tool fails, say so from the error—do not invent results.'
        : 'Do not call tools in this turn.',
      allowTools && toolProfile === 'full'
        ? 'Prefer repo_search/repo_read for this codebase; web_search/web_fetch only for external facts; browser_navigate only when fetch is thin.'
        : allowTools
          ? 'Use repo_search/repo_read to inspect the bound repository.'
          : '',
    ]
      .filter(Boolean)
      .join(' ');

    const announce = (binding: StageBinding) => {
      const model = shortModel(binding.model);
      input.onProgress?.(
        args.stage === 'planner'
          ? interactionMode === 'plan' ? `Planning the change with ${model}` : `Investigating with ${model}`
          : args.stage === 'worker'
            ? interactionMode === 'plan' ? `Checking the plan against the code with ${model}` : `Working on it with ${model}`
            : `Reviewing with ${model}`
      );
    };
    const exec = (binding: StageBinding, compact = false) =>
      withStage(input.onStage, args.stage, () =>
      attemptCompanyCredentialChat({
        onProgress: input.onProgress,
        systemPrompt: compact
          ? `${systemPrompt} Compact recovery: answer from the supplied repository evidence without calling tools. Keep the response concise while preserving the required plan or review format.`
          : systemPrompt,
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        userText: args.userText,
        priorTurns: compact ? [] : args.priorTurns,
        modelProfileId: binding.profileId,
        model: binding.model,
        includeImageTool: !compact && toolProfile === 'full',
        includeRepoTools: !compact && toolProfile !== 'none',
        toolProfile: compact ? 'none' : toolProfile,
        forcePlain: compact || toolProfile === 'none' || shouldForcePlainChat(interactionMode),
        forceToolLoop: !compact && toolProfile !== 'none',
        stopOnUpstreamFailure: true,
        // Give the deterministic server-side excerpts to both investigation stages. Previously the
        // Planner saw them but the Worker only received the Planner's prose, which could collapse
        // real code evidence back into speculative path lists.
        repoContextBlock: args.stage !== 'reviewer'
          ? compact ? repoContextBlock?.slice(0, 3_500) : repoContextBlock
          : undefined,
        maxOutputTokensOverride:
          compact
            ? 1536
            : args.stage === 'planner'
            ? interactionMode === 'plan' || interactionMode === 'build'
              ? 8192
              : undefined
            : interactionMode === 'plan'
              ? 2048
              : interactionMode === 'build'
                ? 4096
                : undefined,
        signal: input.signal,
      })
    );

    const attemptBinding = async (candidate: StageBinding) => {
      let candidateTurn = await exec(candidate);
      if (shouldTryCompactRecovery(candidateTurn)) {
        input.onProgress?.(`${shortModel(candidate.model)} returned an internal error; retrying with compact context and no tools`);
        const compactTurn = await exec(candidate, true);
        candidateTurn = compactTurn.role === 'assistant'
          ? compactTurn
          : {
              ...compactTurn,
              text: `${compactTurn.text}\n\nThe same deployment also failed with a minimal 1,536-token response budget, compact repository evidence, and no tool schemas. This is an upstream model/deployment failure rather than an oversized Nucleas request.`,
            };
      }
      return candidateTurn;
    };

    announce(args.binding);
    const turn = await attemptBinding(args.binding);
    if (turn.role === 'assistant' && args.stage !== 'reviewer' && repoEvidenceReceipts.length) {
      turn.evidenceReceipts = dedupeEvidenceReceipts([...(turn.evidenceReceipts ?? []), ...repoEvidenceReceipts]);
    }
    // Retry once on another eligible model. Transient failures do not open the shared circuit on
    // their first occurrence, so explicitly remove this request's failed binding before re-picking.
    if (retryableProviderFailure(turn)) {
      const need: Need = args.stage === 'planner' ? 'plan' : args.stage === 'reviewer' ? 'review' : workNeedFor(interactionMode, input.userText);
      // A LiteLLM/vLLM deployment update can replace model ids while our catalog is still inside
      // its normal cache window. A 5xx is the one time it is worth paying for a live /v1/models
      // refresh before rerouting; otherwise we can retry yesterday's stale id for six hours.
      const refreshCatalog = /httpStatus=5\d\d\b/.test(turn.debugHint ?? '');
      const fresh = await listAvailableModels({ force: refreshCatalog }).catch(() => null);
      const candidates = fresh?.filter((model) => model.profileId !== args.binding.profileId || model.model !== args.binding.model);
      const next = candidates ? binding((await selectModel(input.organizationId, need, level, { models: candidates, settings })).primary) : null;
      if (next && (next.profileId !== args.binding.profileId || next.model !== args.binding.model)) {
        input.onProgress?.(`${shortModel(args.binding.model)} did not complete; switching to ${shortModel(next.model)}`);
        announce(next);
        return attemptBinding(next);
      }
    }
    return turn;
  }

  if (input.signal?.aborted) {
    return statusTurn('The chat request was cancelled before completion.', 'cancelled');
  }

  const plannerTurn = await runStage({
    stage: 'planner',
    binding: plannerBinding,
    userText: input.userText,
    priorTurns: input.priorTurns,
  });
  if (plannerTurn.role !== 'assistant') return plannerTurn;

  // Preserve paid planning work without exposing an unverified, approvable plan.
  function interruptedStage(stage: 'Worker' | 'Reviewer', failed: TeamChatTurn, turns: TeamChatTurn[]): TeamChatTurn {
    const costs = mergeTurnCosts(turns);
    const draft = interactionMode === 'plan'
      ? parseNucleasPlan(plannerTurn.text)?.displayText ?? plannerTurn.text.replace(/```nucleas-plan\s*[\s\S]*?```/gi, '').trim()
      : '';
    return {
      ...failed,
      role: 'status',
      plan: undefined,
      text: [
        `${stage} stage (${stage === 'Worker' ? workerBinding!.model : reviewerBinding!.model}) did not complete.`,
        failed.text,
        ...(draft ? ['Planner draft preserved below — verification incomplete; not approved or ready to build.', draft] : []),
      ].join('\n\n'),
      ...costs,
    };
  }

  /** Circuit breaker: one correction pass. */
  const maxCompletionPasses = 2;

  if (input.signal?.aborted) {
    return statusTurn('The chat request was cancelled before completion.', 'cancelled', plannerTurn.runId, {
      costMicros: plannerTurn.costMicros,
      reservedMicros: plannerTurn.reservedMicros,
      noProviderFee: plannerTurn.noProviderFee,
    });
  }

  const distilledPlanner = distillPlannerBriefing(plannerTurn.text, interactionMode);

  const workerBrief = [
    'User request:', input.userText.slice(0, 2000), '', 'Planner briefing / jobs:', distilledPlanner, '',
    ...(interactionMode === 'build' ? [BUILD_METHOD, ...(guide ? ['', 'Project guide (excerpt):', guide.slice(0, 3000)] : []), ''] : []),
    'Return one concise completion report covering all jobs. Include concrete evidence, checks performed, limitations, and anything still unverified. Do not narrate routine progress.',
  ].join('\n');

  let workerTurn: TeamChatTurn;
  if (interactionMode === 'build') {
    const execution = await withStage(input.onStage, 'worker', () =>
      // The build runs on the engine's code model for this cost level (the worker pick).
      gatewayFromModelProfile(workerBinding.profileId, workerBinding.model)
        .then(({ gateway }) => ({ endpoint: gateway.endpoint, bearerToken: gateway.bearerToken, model: workerBinding.model }))
        .catch(() => undefined)
        .then((inference) =>
          executeInRemoteSandbox({ organizationId: input.organizationId, projectId: input.projectId, userId: input.userId, task: workerBrief, signal: input.signal, ...(inference ? { inference } : {}) })
        )
    ).catch((error) => ({ error: error instanceof Error ? error.message : 'Sandbox execution failed.' }));
    if (execution && 'error' in execution) {
      workerTurn = statusTurn(execution.error, 'execution_unavailable');
    } else if (execution) {
      const checks = execution.evidence.map((item) => `${item.command.join(' ')}: ${item.timedOut ? 'timed out' : `exit ${item.exitCode}`}`).join('\n');
      workerTurn = {
        requestId: execution.requestId,
        role: 'assistant',
        runId: execution.artifactId,
        noProviderFee: true,
        costMicros: 0,
        reservedMicros: 0,
        toolsUsed: ['sandbox_edit', 'command_execute'],
        text: [
          execution.summary,
          `Model requested: ${execution.routing.requestedModel}`,
          `Model reported by provider: ${execution.routing.providerReportedModels.join(', ') || 'not reported'}`,
          `Base commit: ${execution.baseCommit}`,
          `Changed files:\n${execution.changedFiles.map((file) => `- ${file}`).join('\n') || '- none'}`,
          execution.verification
            ? `Worker payload: verified · ${execution.verification.payloadSha256.slice(0, 12)} · ${execution.verification.checksPassed}/${execution.verification.checksObserved} recorded checks passed`
            : 'Worker payload: legacy worker response (verification receipt unavailable)',
          checks ? `Checks:\n${checks}` : 'Checks: none recorded',
          execution.limitations.length ? `Limitations:\n${execution.limitations.map((item) => `- ${item}`).join('\n')}` : '',
          `Patch artifact: /api/projects/${String(input.projectId)}/ai/ide/executions/${execution.artifactId}`,
          execution.patch ? `Patch excerpt:\n\`\`\`diff\n${execution.patch.slice(0, 3500)}\n\`\`\`` : '',
        ].filter(Boolean).join('\n\n').slice(0, 8000),
      };
    } else {
      workerTurn = await runStage({ stage: 'worker', binding: workerBinding, userText: workerBrief, priorTurns: [] });
    }
  } else {
    workerTurn = await runStage({ stage: 'worker', binding: workerBinding, userText: workerBrief, priorTurns: [] });
    // Medium cost: when the free worker fails, one retry on the level's paid model.
    if (workerTurn.role !== 'assistant' && workerFallback) {
      workerTurn = await runStage({ stage: 'worker', binding: workerFallback, userText: workerBrief, priorTurns: [] });
    }
  }
  if (workerTurn.role !== 'assistant') {
    return interruptedStage('Worker', workerTurn, [plannerTurn, workerTurn]);
  }

  let plan: IdePlanDocument | undefined;
  if (interactionMode === 'plan') {
    const parsed = parseNucleasPlan(plannerTurn.text);
    if (parsed) plan = parsed.plan;
  }

  const assistantStages: TeamChatTurn[] = [plannerTurn, workerTurn];
  let reviewerTurn: TeamChatTurn | null = null;
  let finalChatAnswer: string | null = null;
  let reviewerFormatCorrection = '';

  if (reviewerBinding) {
    for (let pass = 0; pass < maxCompletionPasses; pass += 1) {
      if (input.signal?.aborted) {
        const costs = mergeTurnCosts(assistantStages);
        return statusTurn('The chat request was cancelled before completion.', 'cancelled', workerTurn.runId, {
          costMicros: costs.costMicros,
          reservedMicros: costs.reservedMicros,
          noProviderFee: costs.noProviderFee,
        });
      }
      reviewerTurn = await runStage({
        stage: 'reviewer',
        binding: reviewerBinding,
        userText: [
          'User request:',
          input.userText.slice(0, 1500),
          '',
          'Planner briefing:',
          distilledPlanner,
          '',
          'Worker output:',
          workerTurn.text.slice(0, 6000),
          '',
          'Review all acceptance criteria in one batch. Decide accept vs needs_more. End with a nucleas-gate fence (all interaction modes).',
          reviewerFormatCorrection,
        ].join('\n'),
        priorTurns: [],
      });
      assistantStages.push(reviewerTurn);
      if (reviewerTurn.role !== 'assistant' || !reviewerTurn.text.trim()) {
        return interruptedStage('Reviewer', reviewerTurn, assistantStages);
      }

      const gate = parseReviewerGate(reviewerTurn.text);
      if (gate.status === 'accept') {
        if (interactionMode === 'plan' && !plan) {
          plan = planFromVerifiedFallback(input.userText, plannerTurn.text, workerTurn.text);
        }
        finalChatAnswer = gate.answer.trim() || reviewerTurn.text.trim();
        break;
      }

      if (pass >= maxCompletionPasses - 1) {
        plan = undefined; // A needs_more gate must never publish a ready-for-review plan.
        // Circuit breaker: return best effort from last Worker + Reviewer prose.
        finalChatAnswer =
          [
            workerTurn.text.trim(),
            '',
            '---',
            'Analysis stopped after the safety continue limit before the Reviewer fully accepted.',
            gate.reason ? `Still missing: ${gate.reason}` : '',
            gate.jobs.length ? `Remaining jobs: ${gate.jobs.join('; ')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
            .slice(0, 24_000);
        break;
      }

      // A malformed/missing gate is a Reviewer protocol failure, not missing repository work.
      // Retry the Reviewer against the same evidence instead of making the Worker repeat reads.
      if (['missing_gate_fence', 'malformed_gate_json', 'invalid_gate_object', 'empty_accepted_answer']
        .includes(gate.reason ?? '')) {
        reviewerFormatCorrection = [
          '',
          `Your prior review failed the response contract (${gate.reason}).`,
          'Re-evaluate the same evidence and return complete user-facing prose followed by exactly one valid nucleas-gate JSON fence.',
        ].join('\n');
        continue;
      }

      if (input.signal?.aborted) {
        const costs = mergeTurnCosts(assistantStages);
        return statusTurn('The chat request was cancelled before completion.', 'cancelled', workerTurn.runId, {
          costMicros: costs.costMicros,
          reservedMicros: costs.reservedMicros,
          noProviderFee: costs.noProviderFee,
        });
      }

      workerTurn = await runStage({
        stage: 'worker',
        binding: workerBinding,
        userText: [
          'User request:',
          input.userText.slice(0, 2000),
          '',
          'Planner briefing / jobs:',
          distilledPlanner,
          '',
          'Reviewer needs_more — execute these jobs completely with repo_search/repo_read and quoted evidence:',
          ...gate.jobs.map((job, index) => `${index + 1}. ${job}`),
          gate.reason ? `Reason: ${gate.reason}` : '',
          '',
          'Prior Worker findings (continue from these; do not discard):',
          workerTurn.text.slice(0, 4000),
        ]
          .filter(Boolean)
          .join('\n'),
        priorTurns: [],
      });
      assistantStages.push(workerTurn);
      if (workerTurn.role !== 'assistant') {
        return interruptedStage('Worker', workerTurn, assistantStages);
      }
    }
  }

  const costs = mergeTurnCosts(assistantStages.filter((t) => t.role === 'assistant'));
  if (!reviewerBinding) plan = undefined;

  function reviewerUserFacingText(raw: string): string {
    if (finalChatAnswer) return finalChatAnswer.trim();
    const gate = parseReviewerGate(raw);
    if (gate.status === 'accept') return gate.answer.trim();
    return raw.replace(/```nucleas-gate\s*[\s\S]*?```/i, '').trim() || raw.trim();
  }

  if (reviewerTurn?.role === 'assistant' && reviewerTurn.text.trim()) {
    if (interactionMode === 'chat') {
      return {
        ...reviewerTurn,
        text: reviewerUserFacingText(reviewerTurn.text),
        toolsUsed: costs.toolsUsed,
        artifacts: costs.artifacts,
        evidenceReceipts: costs.evidenceReceipts,
        costMicros: costs.costMicros,
        reservedMicros: costs.reservedMicros,
        noProviderFee: costs.noProviderFee,
        ...(plan ? { plan } : {}),
      };
    }

    if (interactionMode === 'plan' && plan) {
      const display = parseNucleasPlan(plannerTurn.text)?.displayText ?? plannerTurn.text.trim();
      return {
        ...workerTurn,
        text: [
          display,
          '',
          '---',
          '**Worker verification:**',
          workerTurn.text.trim(),
          '',
          '---',
          `**Reviewer (${reviewerBinding!.model}):**`,
          reviewerUserFacingText(reviewerTurn.text),
        ].join('\n'),
        toolsUsed: costs.toolsUsed,
        artifacts: costs.artifacts,
        evidenceReceipts: costs.evidenceReceipts,
        costMicros: costs.costMicros,
        reservedMicros: costs.reservedMicros,
        noProviderFee: costs.noProviderFee,
        plan,
      };
    }

    return {
      ...workerTurn,
      text: [
        workerTurn.text.trim(),
        '',
        '---',
        `**Reviewer (${reviewerBinding!.model}):**`,
        reviewerUserFacingText(reviewerTurn.text),
      ].join('\n'),
      toolsUsed: costs.toolsUsed,
      artifacts: costs.artifacts,
      evidenceReceipts: costs.evidenceReceipts,
      costMicros: costs.costMicros,
      reservedMicros: costs.reservedMicros,
      noProviderFee: costs.noProviderFee,
      ...(plan ? { plan } : {}),
    };
  }

  return {
    ...workerTurn,
    text: workerTurn.text.trim(),
    toolsUsed: costs.toolsUsed,
    artifacts: costs.artifacts,
    evidenceReceipts: costs.evidenceReceipts,
    costMicros: costs.costMicros,
    reservedMicros: costs.reservedMicros,
    noProviderFee: costs.noProviderFee,
    ...(plan ? { plan } : {}),
  };
}
