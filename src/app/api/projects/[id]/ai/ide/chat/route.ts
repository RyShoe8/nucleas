import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AiHttpError, requireAiProject } from '@/lib/ai/control/access';
import { aiError, aiResponse, readAiBody } from '@/lib/ai/control/http';
import { attemptOrchestratedIdeReply } from '@/lib/ai/teamChat';
import { attemptDirectModelChat } from '@/lib/ai/ideDirectChat';
import {
  isIdeChatMode,
  isIdeDirectMode,
  isIdeOrchestratedMode,
  normalizeIdeChatMode,
} from '@/lib/ide/modes';
import { ideChatSchema } from '@/lib/ide/ideChatSchema';
import { loadIdeTaskRuleTexts } from '@/lib/ide/loadTaskRules';
import {
  appendIdeChatTurns,
  clearIdeChatTurnPlan,
  findExistingIdeAssistantTurn,
  loadIdeChatHistory,
} from '@/lib/ide/chatHistory';
import {
  encodeIdeChatNdjsonLine,
  type IdeChatStageCallback,
  type IdeChatStreamEvent,
} from '@/lib/ide/ideChatStream';
import { isMongoDuplicateKeyError, isMongoNetworkError, MONGO_NETWORK_USER_MESSAGE } from '@/lib/utils/mongoErrors';
import { mergeAbortSignals } from '@/lib/ai/control/mergeAbortSignals';
import type { RepositoryEvidenceReceipt } from '@/lib/ai/evidenceReceipts';
import type { StageToolRecord } from '@/lib/ai/stageTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 800; // Vercel Pro with Fluid Compute allows up to 800 s; the plan budgets below are sized to it.
type Context = { params: Promise<{ id: string }> };

function turnPayload(turn: {
  requestId: string;
  role: 'user' | 'assistant' | 'status';
  text: string;
  failureCategory?: string;
  debugHint?: string;
  runId?: string;
  costMicros?: number | null;
  reservedMicros?: number | null;
  noProviderFee?: boolean;
  toolsUsed?: string[];
  artifacts?: { kind: 'image'; assetId: string; name: string; url: string }[];
  evidenceReceipts?: RepositoryEvidenceReceipt[];
  stageTools?: StageToolRecord[];
  plan?: {
    title: string;
    summary: string;
    steps: string[];
    markdown: string;
    status: 'ready_for_review' | 'approved' | 'building';
  };
}) {
  return {
    requestId: turn.requestId,
    role: turn.role,
    text: turn.text,
    failureCategory: turn.failureCategory ?? null,
    debugHint: turn.debugHint ?? null,
    runId: turn.runId ?? null,
    costMicros: turn.costMicros ?? null,
    reservedMicros: turn.reservedMicros ?? null,
    noProviderFee: turn.noProviderFee ?? false,
    artifacts: turn.artifacts ?? [],
    toolsUsed: turn.toolsUsed ?? [],
    evidenceReceipts: turn.evidenceReceipts ?? [],
    stageTools: turn.stageTools ?? [],
    ...(turn.plan ? { plan: turn.plan } : {}),
  };
}

function streamErrorMessage(error: unknown): string {
  if (error instanceof AiHttpError) return error.message;
  if (error instanceof z.ZodError) return 'Invalid input. Check lengths, criteria, and dependencies.';
  if (isMongoDuplicateKeyError(error)) return 'Request already exists. Refresh before retrying.';
  if (typeof error === 'object' && error && 'name' in error && error.name === 'ValidationError') {
    return 'Unable to save this AI credential. Check required fields and try again.';
  }
  if (isMongoNetworkError(error)) return MONGO_NETWORK_USER_MESSAGE;
  return 'AI operation unavailable. Check server configuration and transaction support.';
}

function wantsNdjsonStream(request: NextRequest, streamFlag?: boolean): boolean {
  if (streamFlag === true) return true;
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('application/x-ndjson');
}

function ndjsonResponse(
  request: NextRequest,
  run: (send: (event: IdeChatStreamEvent) => void, signal: AbortSignal) => Promise<void>
): Response {
  const streamAbort = new AbortController();
  const signal = mergeAbortSignals(request.signal, streamAbort.signal);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: IdeChatStreamEvent) => {
        controller.enqueue(encoder.encode(encodeIdeChatNdjsonLine(event)));
      };
      try {
        await run(send, signal);
      } catch (error) {
        if (!signal.aborted) {
          try {
            send({ type: 'error', error: streamErrorMessage(error) });
          } catch {
            // Client already disconnected.
          }
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed after cancel.
        }
      }
    },
    cancel() {
      streamAbort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const access = await requireAiProject(request, (await context.params).id, false, true);
    const modeRaw = request.nextUrl.searchParams.get('mode')?.trim() ?? '';
    const mode = normalizeIdeChatMode(modeRaw);
    if (!mode || !isIdeChatMode(mode)) {
      throw new AiHttpError(400, 'Invalid IDE chat mode.');
    }
    const modelProfileId = request.nextUrl.searchParams.get('modelProfileId')?.trim() ?? '';
    const model = request.nextUrl.searchParams.get('model')?.trim() ?? '';
    const turns = await loadIdeChatHistory({
      organizationId: access.organizationId,
      projectId: access.project._id,
      userId: access.userId,
      mode,
      modelProfileId: isIdeDirectMode(mode) ? modelProfileId : undefined,
      model: isIdeDirectMode(mode) ? model : undefined,
    });
    return aiResponse({ mode, turns });
  } catch (error) {
    return aiError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const access = await requireAiProject(request, (await context.params).id, false, true);
    const input = ideChatSchema.parse(await readAiBody(request));
    const mode = input.mode;
    const ruleTexts = await loadIdeTaskRuleTexts(access.organizationId, access.project._id, mode);
    const userRequestId = input.clientRequestId?.trim() || randomUUID();
    const stream = wantsNdjsonStream(request, input.stream);

    const existingAssistantTurn = await findExistingIdeAssistantTurn({
      organizationId: access.organizationId,
      projectId: access.project._id,
      userId: access.userId,
      requestId: userRequestId,
    });
    if (existingAssistantTurn) {
      const payload = turnPayload({
        requestId: existingAssistantTurn.requestId,
        role: existingAssistantTurn.role,
        text: existingAssistantTurn.text,
        failureCategory: existingAssistantTurn.failureCategory ?? undefined,
        debugHint: existingAssistantTurn.debugHint ?? undefined,
        runId: existingAssistantTurn.runId ?? undefined,
        costMicros: existingAssistantTurn.costMicros ?? undefined,
        reservedMicros: existingAssistantTurn.reservedMicros ?? undefined,
        noProviderFee: existingAssistantTurn.noProviderFee ?? undefined,
        toolsUsed: existingAssistantTurn.toolsUsed ?? undefined,
        artifacts: existingAssistantTurn.artifacts ?? undefined,
        evidenceReceipts: existingAssistantTurn.evidenceReceipts ?? undefined,
        stageTools: existingAssistantTurn.stageTools ?? undefined,
        plan: existingAssistantTurn.plan ?? undefined,
      });
      if (stream) {
        return ndjsonResponse(request, async (send) => {
          send({
            type: 'turn',
            turn: payload,
            mode,
            rulesApplied: ruleTexts.length,
            historyPersisted: true,
          });
        });
      }
      return aiResponse({
        turn: payload,
        mode,
        rulesApplied: ruleTexts.length,
        historyPersisted: true,
      });
    }

    const persistScope = {
      organizationId: access.organizationId,
      projectId: access.project._id,
      userId: access.userId,
      mode,
      modelProfileId: input.modelProfileId,
      model: input.model,
    };

    const logPersistFailure = (which: 'user' | 'assistant', ok: boolean) => {
      if (ok) return;
      console.error('[ide/chat] history persist failed', {
        which,
        projectId: String(access.project._id),
        mode,
        userId: access.userId,
      });
    };

    const persistUserTurn = async () => {
      const ok = await appendIdeChatTurns({
        ...persistScope,
        turns: [{ requestId: userRequestId, role: 'user', text: input.text }],
      });
      logPersistFailure('user', ok);
      return ok;
    };

    const persistAssistantTurn = async (reply: ReturnType<typeof turnPayload>) => {
      const ok = await appendIdeChatTurns({
        ...persistScope,
        turns: [
          {
            requestId: reply.requestId,
            role: reply.role,
            text: reply.text,
            failureCategory: reply.failureCategory ?? null,
            debugHint: reply.debugHint ?? null,
            runId: reply.runId ?? null,
            costMicros: reply.costMicros ?? null,
            reservedMicros: reply.reservedMicros ?? null,
            noProviderFee: reply.noProviderFee ?? false,
            toolsUsed: reply.toolsUsed ?? [],
            artifacts: reply.artifacts ?? [],
            evidenceReceipts: reply.evidenceReceipts ?? [],
            stageTools: reply.stageTools ?? [],
            plan: reply.plan ?? null,
          },
        ],
      });
      logPersistFailure('assistant', ok);
      return ok;
    };

    const deadlineController = new AbortController();
    const deadlineTimeout = setTimeout(() => {
      deadlineController.abort(new Error('Serverless execution deadline approaching (260s limit).'));
    }, 260_000);

    try {
      const runChat = async (incomingSignal: AbortSignal, onStage?: IdeChatStageCallback) => {
        const signal = mergeAbortSignals(incomingSignal, deadlineController.signal);
        const userPersisted = await persistUserTurn();

        if (isIdeDirectMode(mode)) {
          const turn = await attemptDirectModelChat({
            projectName: access.project.name,
            organizationId: access.organizationId,
            projectId: access.project._id,
            userId: access.userId,
            userText: input.text,
            priorTurns: input.history,
            modelProfileId: input.modelProfileId!,
            model: input.model!,
            ruleTexts,
            interactionMode: input.interactionMode,
            signal,
            onStage,
          });
          const payload = turnPayload(turn);
          const assistantPersisted = await persistAssistantTurn(payload);
          return {
            turn: payload,
            mode,
            modelProfileId: input.modelProfileId,
            model: input.model,
            rulesApplied: ruleTexts.length,
            historyPersisted: userPersisted && assistantPersisted,
          };
        }

        if (!isIdeOrchestratedMode(mode)) {
          throw new AiHttpError(400, 'Invalid IDE chat mode.');
        }
        const turn = await attemptOrchestratedIdeReply({
          projectName: access.project.name,
          organizationId: access.organizationId,
          projectId: access.project._id,
          userId: access.userId,
          userText: input.text,
          priorTurns: input.history,
          ruleTexts,
          interactionMode: input.interactionMode,
          level: input.level,
          signal,
          onStage,
          ...(input.interactionMode === 'plan' ? { budgetMs: 700_000 } : {}),
        });
        const payload = turnPayload(turn);
        const assistantPersisted = await persistAssistantTurn(payload);
        return {
          turn: payload,
          mode,
          rulesApplied: ruleTexts.length,
          historyPersisted: userPersisted && assistantPersisted,
        };
      };

      if (stream) {
        return ndjsonResponse(request, async (send, signal) => {
          const result = await runChat(signal, (stage, status) => send({ type: 'stage', stage, status }));
          send({
            type: 'turn',
            turn: result.turn,
            mode: result.mode,
            modelProfileId: 'modelProfileId' in result ? result.modelProfileId : undefined,
            model: 'model' in result ? result.model : undefined,
            rulesApplied: result.rulesApplied,
            historyPersisted: result.historyPersisted,
          });
        });
      }

      const result = await runChat(request.signal);
      return aiResponse(result);
    } finally {
      clearTimeout(deadlineTimeout);
    }
  } catch (error) {
    return aiError(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const access = await requireAiProject(request, (await context.params).id, false, true);
    const requestId = request.nextUrl.searchParams.get('requestId')?.trim() ?? '';
    if (!requestId) {
      throw new AiHttpError(400, 'Provide the chat turn requestId to reject.');
    }
    const cleared = await clearIdeChatTurnPlan({
      organizationId: access.organizationId,
      projectId: access.project._id,
      userId: access.userId,
      requestId,
    });
    return aiResponse({ ok: true, cleared });
  } catch (error) {
    return aiError(error);
  }
}
