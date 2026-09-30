import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAttentionAccess } from '@/lib/ai/control/attention';
import { AiHttpError } from '@/lib/ai/control/access';
import { aiError, aiResponse, readAiBody } from '@/lib/ai/control/http';
import { attemptDirectModelChat } from '@/lib/ai/ideDirectChat';
import { isIdeDirectMode, normalizeIdeChatMode } from '@/lib/ide/modes';
import { ideChatSchema } from '@/lib/ide/ideChatSchema';
import { appendIdeChatTurns, clearIdeChatTurnPlan, loadIdeChatHistory } from '@/lib/ide/chatHistory';
import { freeChatLedgerProjectId } from '@/lib/ide/freeChat';
import {
  encodeIdeChatNdjsonLine,
  type IdeChatStreamEvent,
} from '@/lib/ide/ideChatStream';
import { isMongoDuplicateKeyError, isMongoNetworkError, MONGO_NETWORK_USER_MESSAGE } from '@/lib/utils/mongoErrors';
import { mergeAbortSignals } from '@/lib/ai/control/mergeAbortSignals';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
  stageTools?: { stage: 'planner' | 'worker' | 'reviewer'; model: string; toolsUsed: string[] }[];
  artifacts?: { kind: 'image'; assetId: string; name: string; url: string }[];
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

export async function GET(request: NextRequest) {
  try {
    const access = await requireAttentionAccess(request);
    const modeRaw = request.nextUrl.searchParams.get('mode')?.trim() ?? '';
    const mode = normalizeIdeChatMode(modeRaw);
    if (!mode || !isIdeDirectMode(mode)) {
      throw new AiHttpError(400, 'Free Chat only supports Direct mode.');
    }
    const modelProfileId = request.nextUrl.searchParams.get('modelProfileId')?.trim() ?? '';
    const model = request.nextUrl.searchParams.get('model')?.trim() ?? '';
    const projectId = freeChatLedgerProjectId(access.organizationId);
    const turns = await loadIdeChatHistory({
      organizationId: access.organizationId,
      projectId,
      userId: access.userId,
      mode,
      modelProfileId,
      model,
    });
    return aiResponse({ mode, turns, freeChat: true });
  } catch (error) {
    return aiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAttentionAccess(request);
    const input = ideChatSchema.parse(await readAiBody(request));
    if (!isIdeDirectMode(input.mode)) {
      throw new AiHttpError(400, 'Free Chat only supports Direct mode.');
    }
    if (!input.modelProfileId?.trim() || !input.model?.trim()) {
      throw new AiHttpError(400, 'Choose a company credential and model for Free Chat.');
    }

    const projectId = freeChatLedgerProjectId(access.organizationId);
    const userRequestId = randomUUID();
    const stream = wantsNdjsonStream(request, input.stream);

    const persistScope = {
      organizationId: access.organizationId,
      projectId,
      userId: access.userId,
      mode: input.mode,
      modelProfileId: input.modelProfileId,
      model: input.model,
    };

    const persistUserTurn = async () =>
      appendIdeChatTurns({
        ...persistScope,
        turns: [{ requestId: userRequestId, role: 'user', text: input.text }],
      });

    const persistAndPayload = async (
      turn: Awaited<ReturnType<typeof attemptDirectModelChat>>,
      userPersisted: boolean
    ) => {
      const payload = turnPayload(turn);
      const assistantPersisted = await appendIdeChatTurns({
        ...persistScope,
        turns: [
          {
            requestId: payload.requestId,
            role: payload.role,
            text: payload.text,
            failureCategory: payload.failureCategory ?? null,
            debugHint: payload.debugHint ?? null,
            runId: payload.runId ?? null,
            costMicros: payload.costMicros ?? null,
            reservedMicros: payload.reservedMicros ?? null,
            noProviderFee: payload.noProviderFee ?? false,
            toolsUsed: payload.toolsUsed ?? [],
            stageTools: payload.stageTools ?? [],
            artifacts: payload.artifacts ?? [],
            plan: payload.plan ?? null,
          },
        ],
      });
      return { payload, historyPersisted: userPersisted && assistantPersisted };
    };

    if (stream) {
      return ndjsonResponse(request, async (send, signal) => {
        const userPersisted = await persistUserTurn();
        const turn = await attemptDirectModelChat({
          projectName: 'Free Chat',
          organizationId: access.organizationId,
          projectId,
          userId: access.userId,
          userText: input.text,
          priorTurns: input.history,
          modelProfileId: input.modelProfileId!,
          model: input.model!,
          ruleTexts: [],
          interactionMode: input.interactionMode,
          includeRepoTools: false,
          signal,
          onStage: (stage, status) => send({ type: 'stage', stage, status }),
        });
        const { payload, historyPersisted } = await persistAndPayload(turn, userPersisted);
        send({
          type: 'turn',
          turn: payload,
          mode: input.mode,
          modelProfileId: input.modelProfileId,
          model: input.model,
          rulesApplied: 0,
          freeChat: true,
          historyPersisted,
        });
      });
    }

    const userPersisted = await persistUserTurn();
    const turn = await attemptDirectModelChat({
      projectName: 'Free Chat',
      organizationId: access.organizationId,
      projectId,
      userId: access.userId,
      userText: input.text,
      priorTurns: input.history,
      modelProfileId: input.modelProfileId!,
      model: input.model!,
      ruleTexts: [],
      interactionMode: input.interactionMode,
      includeRepoTools: false,
      signal: request.signal,
    });
    const { payload, historyPersisted } = await persistAndPayload(turn, userPersisted);
    return aiResponse({
      turn: payload,
      mode: input.mode,
      modelProfileId: input.modelProfileId,
      model: input.model,
      rulesApplied: 0,
      freeChat: true,
      historyPersisted,
    });
  } catch (error) {
    return aiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await requireAttentionAccess(request);
    const requestId = request.nextUrl.searchParams.get('requestId')?.trim() ?? '';
    if (!requestId) {
      throw new AiHttpError(400, 'Provide the chat turn requestId to reject.');
    }
    const projectId = freeChatLedgerProjectId(access.organizationId);
    const cleared = await clearIdeChatTurnPlan({
      organizationId: access.organizationId,
      projectId,
      userId: access.userId,
      requestId,
    });
    return aiResponse({ ok: true, cleared });
  } catch (error) {
    return aiError(error);
  }
}
