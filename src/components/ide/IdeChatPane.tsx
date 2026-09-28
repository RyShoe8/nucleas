'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatIdeCostUsd } from '@/lib/ide/costDisplay';
import { isIdeDirectMode, type IdeChatMode } from '@/lib/ide/modes';
import {
  readStoredIdeDirectSelection,
  readStoredIdeDraft,
  readStoredIdeInteractionMode,
  writeStoredIdeDirectSelection,
  writeStoredIdeDraft,
  writeStoredIdeInteractionMode,
} from '@/lib/ide/chatSelectionStorage';
import { shortModelDisplayName } from '@/lib/ai/rolePipeline/providerCatalog';
import {
  ChatModeSwitch,
  CostSelect,
  DirectModelPicker,
  levelParam,
  readCostChoice,
  resolveDirectSelection,
  useEngineProviders,
  type CostChoice,
} from '@/components/ai/EngineControls';
import ImagePreviewModal from '@/components/shared/ImagePreviewModal';
import IdeChatMarkdown from '@/components/ide/IdeChatMarkdown';
import type { IdeInteractionMode, IdePlanDocument, IdeRunActivity } from '@/lib/ide/idePlan';
import { buildDioramaDesks, ideChatThreadCacheKey } from '@/lib/ide/ideChatThreadCache';
import { runSceneFromState } from '@/lib/ide/runScenePhases';
import type { IdeChatStage, IdeChatStreamEvent } from '@/lib/ide/ideChatStream';
import { userFirstNameFromProfile } from '@/lib/utils/userDisplayName';
import { isIdeFreeChatScope } from '@/lib/ide/freeChat';
import type { MutableRefObject } from 'react';

function ideChatEndpoint(projectId: string): string {
  return isIdeFreeChatScope(projectId)
    ? '/api/ai/ide/free-chat'
    : `/api/projects/${encodeURIComponent(projectId)}/ai/ide/chat`;
}

type ChatTurn = {
  requestId: string;
  role: 'user' | 'assistant' | 'status';
  text: string;
  failureCategory?: string | null;
  debugHint?: string | null;
  costMicros?: number | null;
  reservedMicros?: number | null;
  noProviderFee?: boolean;
  artifacts?: { kind: 'image'; assetId: string; name: string; url: string }[];
  toolsUsed?: string[];
  plan?: IdePlanDocument;
};

function fallbackStageForMode(_mode: IdeInteractionMode): IdeChatStage {
  return 'planner';
}

async function readIdeChatNdjson(
  response: Response,
  onEvent: (event: IdeChatStreamEvent) => void
): Promise<{ turn?: ChatTurn; error?: string }> {
  if (!response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string; turn?: ChatTurn } | null;
    if (body?.turn) return { turn: body.turn };
    return { error: body?.error ?? 'Chat request failed.' };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let turn: ChatTurn | undefined;
  let streamError: string | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          const event = JSON.parse(line) as IdeChatStreamEvent;
          onEvent(event);
          if (event.type === 'turn') turn = event.turn as ChatTurn;
          if (event.type === 'error') streamError = event.error;
        } catch {
          /* skip malformed line */
        }
      }
      newline = buffer.indexOf('\n');
    }
  }
  const rest = buffer.trim();
  if (rest) {
    try {
      const event = JSON.parse(rest) as IdeChatStreamEvent;
      onEvent(event);
      if (event.type === 'turn') turn = event.turn as ChatTurn;
      if (event.type === 'error') streamError = event.error;
    } catch {
      /* ignore */
    }
  }
  return { turn, error: streamError };
}

type Props = {
  projectId: string | null;
  /** When false, defer history GET until project scope is restored (avoids free-chat ledger). */
  chatScopeReady?: boolean;
  mode: IdeChatMode;
  onModeChange: (mode: IdeChatMode) => void;
  onOpenRules?: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  onPlanReady?: (plan: IdePlanDocument | null) => void;
  onRunActivity?: (activity: IdeRunActivity) => void;
  approvePlanRef?: MutableRefObject<((plan: IdePlanDocument) => void) | null>;
  rejectPlanRef?: MutableRefObject<(() => void | Promise<void>) | null>;
};

const CHAT_MIN_WIDTH = 280;
const CHAT_MAX_WIDTH = 820;

export default function IdeChatPane({
  projectId,
  chatScopeReady = true,
  mode,
  onModeChange,
  onOpenRules,
  width,
  onWidthChange,
  onPlanReady,
  onRunActivity,
  approvePlanRef,
  rejectPlanRef,
}: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [draftScopeKey, setDraftScopeKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyPersistFailed, setHistoryPersistFailed] = useState(false);
  const [resizing, setResizing] = useState(false);
  const { providers, loaded: providersLoaded } = useEngineProviders();
  const [cost, setCost] = useState<CostChoice>('default');
  const [directProfileId, setDirectProfileId] = useState('');
  const [directModel, setDirectModel] = useState('');
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [interactionMode, setInteractionMode] = useState<Exclude<IdeInteractionMode, 'build'>>('chat');
  /** In-flight request mode (includes `build`); UI toggle never stores `build`. */
  const [busyRequestMode, setBusyRequestMode] = useState<IdeInteractionMode | null>(null);
  const [liveStage, setLiveStage] = useState<IdeChatStage | null>(null);
  const [doneStages, setDoneStages] = useState<IdeChatStage[]>([]);
  const [busyTick, setBusyTick] = useState(0);
  const [lastToolsUsed, setLastToolsUsed] = useState<string[]>([]);
  const [planReadyFlag, setPlanReadyFlag] = useState(false);
  const [activityFailed, setActivityFailed] = useState(false);
  const [userFirstName, setUserFirstName] = useState('You');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendGenerationRef = useRef(0);
  const historyGenerationRef = useRef(0);
  const [historyRefetchNonce, setHistoryRefetchNonce] = useState(0);
  const turnsRef = useRef<ChatTurn[]>([]);
  const threadCacheRef = useRef<Map<string, ChatTurn[]>>(new Map());
  turnsRef.current = turns;

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/me', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { name?: string | null; email?: string | null } | null;
        if (!data || controller.signal.aborted) return;
        setUserFirstName(userFirstNameFromProfile(data.name, data.email));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  function persistDirectSelection(profileId: string, model: string) {
    if (!projectId || !profileId.trim() || !model.trim()) return;
    writeStoredIdeDirectSelection(projectId, { profileId, model });
  }

  useLayoutEffect(() => {
    if (!projectId) {
      setDirectProfileId('');
      setDirectModel('');
      return;
    }
    // Same as Free Chat: hydrate company/model before the history GET so we do not
    // sit on `:direct:pending` (or fetch the wrong Direct thread) after refresh.
    const stored = readStoredIdeDirectSelection(projectId);
    setDirectProfileId(stored?.profileId ?? '');
    setDirectModel(stored?.model ?? '');
  }, [projectId]);

  useEffect(() => {
    setCost(readCostChoice());
  }, []);

  // Once providers load, replace a saved Direct choice that is no longer listed.
  useEffect(() => {
    if (!projectId || !providersLoaded) return;
    const next = resolveDirectSelection(providers, directProfileId ? { profileId: directProfileId, model: directModel } : null);
    if (next && (next.profileId !== directProfileId || next.model !== directModel)) {
      setDirectProfileId(next.profileId);
      setDirectModel(next.model);
      persistDirectSelection(next.profileId, next.model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the provider list or project changes
  }, [projectId, providersLoaded, providers]);

  useEffect(() => {
    if (!projectId) {
      setInteractionMode('chat');
      return;
    }
    const stored = readStoredIdeInteractionMode(projectId);
    setInteractionMode(stored === 'plan' ? 'plan' : 'chat');
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    writeStoredIdeInteractionMode(projectId, interactionMode);
  }, [projectId, interactionMode]);

  useEffect(() => {
    if (!busy) {
      setBusyTick(0);
      return;
    }
    setBusyTick(0);
    const first = window.setTimeout(() => setBusyTick(1), 700);
    const second = window.setTimeout(() => setBusyTick(2), 1800);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [busy]);

  const targetLabel = useMemo(() => {
    if (isIdeDirectMode(mode)) {
      return directModel ? shortModelDisplayName(directModel) : 'Direct model';
    }
    return 'Orchestrated';
  }, [mode, directModel]);

  const historyScopeKey = useMemo(() => {
    if (!projectId) return '';
    if (isIdeDirectMode(mode)) {
      if (!directProfileId.trim() || !directModel.trim()) return `${projectId}:direct:pending`;
      return `${projectId}:direct:${directProfileId}:${directModel}`;
    }
    return ideChatThreadCacheKey({ projectId, mode });
  }, [projectId, mode, directProfileId, directModel]);

  useEffect(() => {
    setDraftScopeKey(historyScopeKey);
    if (!historyScopeKey || historyScopeKey.endsWith(':direct:pending')) {
      setDraft('');
      return;
    }
    setDraft(readStoredIdeDraft(historyScopeKey));
  }, [historyScopeKey]);

  useEffect(() => {
    if (draftScopeKey !== historyScopeKey || !historyScopeKey || historyScopeKey.endsWith(':direct:pending')) return;
    writeStoredIdeDraft(historyScopeKey, draft);
  }, [historyScopeKey, draft, draftScopeKey]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sendGenerationRef.current += 1;
    const generation = ++historyGenerationRef.current;
    setBusy(false);
    setError('');
    setHistoryPersistFailed(false);
    setPlanReadyFlag(false);
    setActivityFailed(false);
    setLastToolsUsed([]);

    const cacheKey = ideChatThreadCacheKey({
      projectId: projectId ?? '',
      mode,
      modelProfileId: isIdeDirectMode(mode) ? directProfileId : undefined,
      model: isIdeDirectMode(mode) ? directModel : undefined,
    });
    const cached = threadCacheRef.current.get(cacheKey);
    if (cached?.length) {
      turnsRef.current = cached;
      setTurns(cached);
      const latestPlan = [...cached].reverse().find((turn) => turn.plan)?.plan ?? null;
      if (latestPlan) {
        setPlanReadyFlag(latestPlan.status === 'ready_for_review');
        onPlanReady?.(latestPlan);
      } else {
        onPlanReady?.(null);
      }
    } else {
      // Never display or send the previous thread while this thread loads (or fails).
      turnsRef.current = [];
      setTurns([]);
      onPlanReady?.(null);
    }

    if (!projectId || !chatScopeReady || historyScopeKey.endsWith(':direct:pending')) {
      if (!cached?.length && historyScopeKey.endsWith(':direct:pending')) {
        setTurns([]);
        onPlanReady?.(null);
      }
      setHistoryLoading(false);
      return;
    }

    const controller = new AbortController();
    setHistoryLoading(true);
    const params = new URLSearchParams({ mode });
    if (isIdeDirectMode(mode)) {
      params.set('modelProfileId', directProfileId);
      params.set('model', directModel);
    }

    void (async () => {
      try {
        const response = await fetch(`${ideChatEndpoint(projectId)}?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (generation !== historyGenerationRef.current || controller.signal.aborted) return;
        const body = await response.json();
        if (generation !== historyGenerationRef.current || controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error ?? 'Unable to load chat history.');
        const loaded = (body.turns ?? []) as ChatTurn[];
        // Never wipe a non-empty local thread with an empty server response (persist lag / soft-fail).
        if (loaded.length === 0) {
          const existing = threadCacheRef.current.get(cacheKey);
          if (existing?.length) {
            setTurns(existing);
            return;
          }
          // Do not cache [] — avoids locking in a soft-empty GET after Free→Project races.
          setTurns([]);
          setPlanReadyFlag(false);
          onPlanReady?.(null);
          return;
        }
        threadCacheRef.current.set(cacheKey, loaded);
        setTurns(loaded);
        const latestPlan = [...loaded].reverse().find((turn) => turn.plan)?.plan ?? null;
        if (latestPlan) {
          setPlanReadyFlag(latestPlan.status === 'ready_for_review');
          onPlanReady?.(latestPlan);
        } else {
          setPlanReadyFlag(false);
          onPlanReady?.(null);
        }
      } catch (err) {
        if (generation !== historyGenerationRef.current || controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Unable to load chat history.');
      } finally {
        if (generation === historyGenerationRef.current) setHistoryLoading(false);
      }
    })();

    return () => controller.abort();
  }, [historyScopeKey, chatScopeReady, historyRefetchNonce, mode, projectId, directProfileId, directModel, onPlanReady]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  const dioramaDesks = useMemo(() => {
    if (isIdeDirectMode(mode)) {
      return buildDioramaDesks({
        direct: true,
        directModelLabel: directModel ? shortModelDisplayName(directModel) : 'Direct',
        busy,
        activeStage: liveStage ?? 'direct',
        doneStages,
      });
    }
    const deskMode = busyRequestMode ?? interactionMode;
    const activeStage = liveStage ?? (busy ? fallbackStageForMode(deskMode) : null);
    // Orchestrated: the engine picks each stage's model per request, so desks show roles only.
    return buildDioramaDesks({
      stages: {},
      busy,
      activeStage,
      doneStages,
    });
  }, [mode, directModel, busy, interactionMode, busyRequestMode, liveStage, doneStages]);

  useEffect(() => {
    onRunActivity?.(
      runSceneFromState({
        busy,
        interactionMode: busyRequestMode ?? interactionMode,
        targetLabel,
        toolsUsed: lastToolsUsed,
        planReady: planReadyFlag,
        failed: activityFailed,
        busyTick,
        desks: dioramaDesks,
        liveStage,
      })
    );
  }, [
    busy,
    interactionMode,
    busyRequestMode,
    liveStage,
    targetLabel,
    lastToolsUsed,
    planReadyFlag,
    activityFailed,
    busyTick,
    dioramaDesks,
    onRunActivity,
  ]);

  useEffect(() => {
    if (!resizing) return;

    const clampWidth = (next: number) => {
      const max = Math.min(CHAT_MAX_WIDTH, Math.floor(window.innerWidth * 0.7));
      return Math.min(max, Math.max(CHAT_MIN_WIDTH, next));
    };

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      onWidthChange(clampWidth(drag.startWidth + (drag.startX - event.clientX)));
    };

    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setResizing(false);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [resizing, onWidthChange]);

  function onResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  async function postChat(args: {
    text: string;
    modeForRequest: IdeInteractionMode;
    appendUserTurn: boolean;
  }) {
    if (!projectId || !chatScopeReady || busy || historyLoading) return;
    if (isIdeDirectMode(mode) && (!directProfileId || !directModel.trim())) {
      setError('Pick a provider and model for Direct chat.');
      return;
    }

    setBusy(true);
    setBusyRequestMode(args.modeForRequest);
    setLiveStage(isIdeDirectMode(mode) ? 'direct' : fallbackStageForMode(args.modeForRequest));
    setDoneStages([]);
    setError('');
    setActivityFailed(false);
    if (args.modeForRequest === 'plan') setPlanReadyFlag(false);
    if (args.modeForRequest === 'build') setPlanReadyFlag(false);

    const priorTurns = turnsRef.current;
    const userRequestId = crypto.randomUUID();
    let historyBase = priorTurns;
    if (args.appendUserTurn) {
      const userTurn: ChatTurn = {
        requestId: userRequestId,
        role: 'user',
        text: args.text,
      };
      historyBase = [...priorTurns, userTurn];
      setTurns(historyBase);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++sendGenerationRef.current;

    try {
      const history = priorTurns
        .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
        .slice(-8)
        .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 6000) }));
      const response = await fetch(ideChatEndpoint(projectId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          mode,
          text: args.text.slice(0, 6000),
          history,
          interactionMode: args.modeForRequest,
          clientRequestId: userRequestId,
          stream: true,
          ...(isIdeDirectMode(mode)
            ? { modelProfileId: directProfileId, model: directModel }
            : levelParam(cost)),
        }),
        signal: controller.signal,
      });
      if (generation !== sendGenerationRef.current || controller.signal.aborted) return;

      const contentType = response.headers.get('content-type') ?? '';
      let turn: ChatTurn | undefined;
      let historyPersisted: boolean | undefined;
      if (contentType.includes('application/x-ndjson') || contentType.includes('ndjson')) {
        const streamed = await readIdeChatNdjson(response, (event) => {
          if (generation !== sendGenerationRef.current) return;
          if (event.type === 'turn' && typeof event.historyPersisted === 'boolean') {
            historyPersisted = event.historyPersisted;
          }
          if (event.type !== 'stage') return;
          if (event.status === 'start') {
            setLiveStage(event.stage);
          } else {
            setDoneStages((prev) => (prev.includes(event.stage) ? prev : [...prev, event.stage]));
          }
        });
        if (generation !== sendGenerationRef.current || controller.signal.aborted) return;
        if (!response.ok || streamed.error) {
          throw new Error(streamed.error ?? 'Chat request failed.');
        }
        turn = streamed.turn;
      } else {
        const body = await response.json();
        if (generation !== sendGenerationRef.current || controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error ?? 'Chat request failed.');
        turn = body.turn as ChatTurn;
        if (typeof body.historyPersisted === 'boolean') historyPersisted = body.historyPersisted;
      }
      if (!turn) throw new Error('Chat request failed.');

      const nextTurns = [...historyBase, turn];
      const cacheKey = ideChatThreadCacheKey({
        projectId,
        mode,
        modelProfileId: isIdeDirectMode(mode) ? directProfileId : undefined,
        model: isIdeDirectMode(mode) ? directModel : undefined,
      });
      threadCacheRef.current.set(cacheKey, nextTurns);
      setTurns(nextTurns);
      setLastToolsUsed(turn.toolsUsed ?? []);
      if (turn.role === 'status') setActivityFailed(true);
      if (turn.plan) {
        setPlanReadyFlag(turn.plan.status === 'ready_for_review');
        onPlanReady?.(turn.plan);
      }
      if (historyPersisted === false) {
        setHistoryPersistFailed(true);
        const scopeHint = isIdeFreeChatScope(projectId)
          ? 'scope: Free Chat'
          : `scope: project ${projectId}, mode ${mode}`;
        setError(
          `Reply ready, but this turn was not saved to project history (${scopeHint}). It may disappear after you leave the IDE — try sending again.`
        );
      } else if (historyPersisted === true) {
        setHistoryPersistFailed(false);
        setHistoryRefetchNonce((n) => n + 1);
      }
    } catch (err) {
      if (generation !== sendGenerationRef.current) return;
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        setTurns((current) => [
          ...current,
          {
            requestId: crypto.randomUUID(),
            role: 'status',
            text: 'Stopped.',
          },
        ]);
        return;
      }
      setActivityFailed(true);
      const raw = err instanceof Error ? err.message : 'Chat request failed.';
      setError(
        /failed to fetch|networkerror|network error/i.test(raw)
          ? 'Connection dropped before the reply finished (often a timeout). Wait a moment and try again.'
          : raw
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (generation === sendGenerationRef.current) {
        setBusy(false);
        setBusyRequestMode(null);
        setLiveStage(null);
        setDoneStages([]);
      }
    }
  }

  async function send() {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    await postChat({ text, modeForRequest: interactionMode, appendUserTurn: true });
  }

  function approveAndBuild(plan: IdePlanDocument) {
    if (busy) return;
    const building: IdePlanDocument = { ...plan, status: 'building' };
    onPlanReady?.(building);
    setPlanReadyFlag(false);
    const header = `Approved plan: "${plan.title || 'Implementation Plan'}"\nBuild this plan in the isolated disposable repository, run focused verification, and return the proposed patch and evidence. Never commit, push, or deploy; publishing requires separate review and approval.`;
    const snippet = plan.markdown.length > 4000 ? `${plan.markdown.slice(0, 4000)}\n\n[...plan continues...]` : plan.markdown;
    const text = `${header}\n\n${snippet}`.slice(0, 5900);
    void postChat({ text, modeForRequest: 'build', appendUserTurn: true });
  }

  async function rejectActivePlan() {
    const requestIds = turnsRef.current
      .filter((turn) => Boolean(turn.plan))
      .map((turn) => turn.requestId);
    if (!requestIds.length) {
      setPlanReadyFlag(false);
      onPlanReady?.(null);
      return;
    }
    if (!projectId) {
      setError('Unable to reject plan without a project scope.');
      return;
    }

    try {
      for (const requestId of requestIds) {
        const response = await fetch(
          `${ideChatEndpoint(projectId)}?requestId=${encodeURIComponent(requestId)}`,
          { method: 'DELETE', cache: 'no-store' }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body.error === 'string' ? body.error : 'Unable to reject plan.'
          );
        }
      }

      setPlanReadyFlag(false);
      setTurns((current) => {
        const next = current.map((turn) => {
          if (!turn.plan) return turn;
          const { plan: _removed, ...rest } = turn;
          return rest;
        });
        const key = ideChatThreadCacheKey({
          projectId: projectId ?? '',
          mode,
          modelProfileId: isIdeDirectMode(mode) ? directProfileId : undefined,
          model: isIdeDirectMode(mode) ? directModel : undefined,
        });
        threadCacheRef.current.set(key, next);
        return next;
      });
      onPlanReady?.(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reject plan.');
    }
  }

  useEffect(() => {
    if (!approvePlanRef) return;
    approvePlanRef.current = approveAndBuild;
    return () => {
      approvePlanRef.current = null;
    };
  });

  useEffect(() => {
    if (!rejectPlanRef) return;
    rejectPlanRef.current = rejectActivePlan;
    return () => {
      rejectPlanRef.current = null;
    };
  });

  function stop() {
    abortRef.current?.abort();
  }

  const canSendDirect = !isIdeDirectMode(mode) || Boolean(directProfileId && directModel.trim());

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-background-card"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat pane"
        aria-valuenow={Math.round(width)}
        aria-valuemin={CHAT_MIN_WIDTH}
        aria-valuemax={CHAT_MAX_WIDTH}
        tabIndex={0}
        className={`absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none ${
          resizing ? 'bg-primary/50' : 'bg-transparent hover:bg-primary/30'
        }`}
        onPointerDown={onResizePointerDown}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onWidthChange(Math.min(CHAT_MAX_WIDTH, width + 16));
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            onWidthChange(Math.max(CHAT_MIN_WIDTH, width - 16));
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-2">
        <ChatModeSwitch
          mode={mode}
          onChange={onModeChange}
          allowOrchestrated={!isIdeFreeChatScope(projectId)}
        />
        {isIdeDirectMode(mode) ? (
          <DirectModelPicker
            providers={providers}
            value={directProfileId && directModel ? { profileId: directProfileId, model: directModel } : null}
            disabled={!projectId || busy}
            onChange={(next) => {
              setDirectProfileId(next.profileId);
              setDirectModel(next.model);
              persistDirectSelection(next.profileId, next.model);
            }}
          />
        ) : (
          <CostSelect value={cost} onChange={setCost} disabled={busy} />
        )}
        {onOpenRules ? (
          <button
            type="button"
            onClick={onOpenRules}
            className="ml-auto rounded border border-border px-2 py-1 text-xs text-text-secondary"
          >
            Rules
          </button>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3 text-sm">
        {turns.length === 0 && isIdeDirectMode(mode) ? (
          <p className="text-xs text-text-secondary">
            {isIdeFreeChatScope(projectId)
              ? 'Free Chat is Direct chat — pick a provider and model and ask about anything. Switch to a project for Orchestrated chat with its files.'
              : 'Direct mode chats with one model you choose.'}
          </p>
        ) : null}
        {turns.map((turn) => {
          const cost =
            turn.role === 'assistant' || turn.role === 'status'
              ? formatIdeCostUsd({
                  costMicros: turn.costMicros ?? null,
                  reservedMicros: turn.reservedMicros ?? null,
                  noProviderFee: turn.noProviderFee ?? false,
                })
              : null;
          return (
            <div
              key={turn.requestId}
              className={`rounded border px-2 py-2 ${
                turn.role === 'user'
                  ? 'border-border bg-background'
                  : turn.role === 'status'
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-border'
              }`}
            >
              <div className="mb-1 text-[10px] tracking-wide text-text-secondary">
                {turn.role === 'user'
                  ? userFirstName
                  : turn.role === 'status'
                    ? 'Status'
                    : 'Assistant'}
              </div>
              {turn.role === 'status' ? (
                <div className="whitespace-pre-wrap text-text-primary">{turn.text}</div>
              ) : (
                <IdeChatMarkdown text={turn.text} />
              )}
              {turn.role === 'status' && turn.debugHint ? (
                <p className="mt-1 font-mono text-[10px] text-text-secondary break-all">{turn.debugHint}</p>
              ) : null}
              {turn.toolsUsed?.length ? (
                <div className="mt-1 text-[11px] text-text-secondary">
                  Tools: {turn.toolsUsed.join(', ')}
                </div>
              ) : null}
              {turn.artifacts?.length ? (
                <div className="mt-3 space-y-3">
                  {turn.artifacts.map((artifact) => (
                    <figure
                      key={artifact.assetId}
                      className="overflow-hidden rounded border border-border bg-background"
                    >
                      <figcaption className="border-b border-border px-2 py-1.5 text-[11px] text-text-secondary">
                        {artifact.name}
                      </figcaption>
                      <button
                        type="button"
                        className="block w-full text-left"
                        onClick={() => setPreviewImage({ src: artifact.url, title: artifact.name })}
                        title="View full size"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={artifact.url}
                          alt={artifact.name}
                          className="max-h-56 w-full object-contain bg-black/5"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      </button>
                      <div className="border-t border-border px-2 py-1">
                        <button
                          type="button"
                          className="text-[11px] text-text-secondary underline underline-offset-2 hover:text-text-primary"
                          onClick={() => setPreviewImage({ src: artifact.url, title: artifact.name })}
                        >
                          View full size
                        </button>
                      </div>
                    </figure>
                  ))}
                </div>
              ) : null}
              {cost && cost.amount !== '—' ? (
                <div className="mt-1 text-[11px] text-text-secondary">
                  {cost.label === 'budget hold' ? 'Budget hold ' : ''}
                  {cost.amount}
                  {cost.label === 'estimated' ? ' est.' : ''}
                  {cost.label === 'no provider fee' ? ' · no provider fee' : ''}
                  {cost.label === 'budget hold' ? ' · not metered' : ''}
                </div>
              ) : null}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {historyPersistFailed ? (
        <div
          className="mx-3 mb-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200"
          role="status"
        >
          Chat history did not save to this project. Leave/return may lose this thread until a turn
          saves successfully.
        </div>
      ) : null}
      {error ? <p className="px-3 text-xs text-red-500">{error}</p> : null}
      <div className="border-t border-border p-2">
        <div
          className="mb-2 inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-medium"
          role="group"
          aria-label="Chat or Plan intent"
        >
          {(['chat', 'plan'] as const).map((item) => (
            <button
              key={item}
              type="button"
              disabled={busy}
              onClick={() => setInteractionMode(item)}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                interactionMode === item
                  ? 'bg-background-card text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {item === 'chat' ? 'Chat' : 'Plan'}
            </button>
          ))}
        </div>
        <textarea
          className="mb-2 h-20 w-full resize-none rounded border border-border bg-background p-2 text-sm text-text-primary"
          placeholder={
            !projectId
              ? 'Select a project first'
              : interactionMode === 'plan'
                ? 'What should we plan?'
                : isIdeDirectMode(mode)
                  ? 'Ask the model…'
                  : 'Ask anything about this project…'
          }
          value={draft}
          disabled={!projectId || busy || historyLoading}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button type="button" className="w-full rounded border border-border px-3 py-2 text-sm" onClick={stop}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="w-full rounded border border-border px-3 py-2 text-sm disabled:opacity-50"
            disabled={!projectId || !draft.trim() || !canSendDirect || historyLoading}
            onClick={() => void send()}
          >
            {historyLoading ? 'Loading…' : 'Send'}
          </button>
        )}
      </div>
      <ImagePreviewModal
        isOpen={Boolean(previewImage)}
        src={previewImage?.src ?? null}
        title={previewImage?.title ?? 'Generated image'}
        onClose={() => setPreviewImage(null)}
        stackAboveLightbox
      />
    </aside>
  );
}
