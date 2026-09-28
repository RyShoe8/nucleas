'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import IdeChatPane from '@/components/ide/IdeChatPane';
import IdeEditor from '@/components/ide/IdeEditor';
import IdeFileTree from '@/components/ide/IdeFileTree';
import IdePlanPane from '@/components/ide/IdePlanPane';
import IdeProjectRepoSwitcher from '@/components/ide/IdeProjectRepoSwitcher';
import IdePublishApproval from '@/components/ide/IdePublishApproval';
import IdeRunScene from '@/components/ide/IdeRunScene';
import IdeTaskRulesPanel from '@/components/ide/IdeTaskRulesPanel';
import type { IdeChatMode } from '@/lib/ide/modes';
import type { IdePlanDocument, IdeRunActivity } from '@/lib/ide/idePlan';
import {
  markExplicitFreeChatSelection,
  readStoredIdeChatMode,
  readStoredIdeLayout,
  resolveInitialIdeProjectId,
  syncIdeProjectUrl,
  writeStoredIdeChatMode,
  writeStoredIdeLayout,
  writeStoredIdeProjectId,
} from '@/lib/ide/chatSelectionStorage';
import { runSceneFromState } from '@/lib/ide/runScenePhases';
import { microsToDollars } from '@/lib/ai/settingsSchema';
import { IDE_FREE_CHAT_SCOPE, isIdeFreeChatScope } from '@/lib/ide/freeChat';

type TreeEntry = { name: string; path: string; type: 'file' | 'dir'; sha: string };

type RepositorySnapshot = {
  repository: {
    owner: string;
    repo: string;
    defaultBranch: string;
    installationId: string | null;
  } | null;
  connectionStatus: string;
  githubAppConfigured: boolean;
  canManage: boolean;
};

type SpendSnapshot = {
  dailyEstimatedMicros: number;
  monthlyEstimatedMicros: number;
  orgMonthlyEstimatedMicros: number;
  searchApiEstimatedMicros: number;
  freeChat?: boolean;
};

function formatSpend(micros: number): string {
  return `$${microsToDollars(micros)}`;
}

/** Sync mode for a project scope — Free Chat is always Direct; projects default to Orchestrated. */
function modeForProject(projectId: string): IdeChatMode {
  if (isIdeFreeChatScope(projectId)) return 'direct';
  if (typeof window !== 'undefined') {
    const stored = readStoredIdeChatMode(projectId);
    // Direct on a project is fine while using that tab, but do not restore it as the
    // default after refresh — that opens an empty Direct thread while orchestrated history exists.
    if (stored && stored !== 'direct') return stored;
  }
  return 'orchestrated';
}

export default function IdeShell({ initialProjectId }: { initialProjectId?: string }) {
  const [projectId, setProjectId] = useState<string | null>(() =>
    resolveInitialIdeProjectId(initialProjectId)
  );
  const freeChat = isIdeFreeChatScope(projectId);
  const [repository, setRepository] = useState<RepositorySnapshot | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [rootEntries, setRootEntries] = useState<TreeEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, TreeEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeReason, setTreeReason] = useState<string | null>(null);
  const [treeBranch, setTreeBranch] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [fileSha, setFileSha] = useState<string | null>(null);
  const openFileAbortRef = useRef<AbortController | null>(null);
  const openFileGenerationRef = useRef(0);
  const [mode, setMode] = useState<IdeChatMode>(() =>
    modeForProject(resolveInitialIdeProjectId(initialProjectId))
  );
  const [rulesOpen, setRulesOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(352);
  const [centerView, setCenterView] = useState<'file' | 'plan'>('file');
  const [activePlan, setActivePlan] = useState<IdePlanDocument | null>(null);
  const [spend, setSpend] = useState<SpendSnapshot | null>(null);
  const [runActivity, setRunActivity] = useState<IdeRunActivity>(() =>
    runSceneFromState({ busy: false, interactionMode: 'chat' })
  );
  const approvePlanRef = useRef<((plan: IdePlanDocument) => void) | null>(null);
  const rejectPlanRef = useRef<(() => void | Promise<void>) | null>(null);
  const prevBusyRef = useRef(false);
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;
  const restorePathRef = useRef<string | null>(null);
  const skipLayoutWriteRef = useRef(false);

  useEffect(() => {
    if (!projectId || isIdeFreeChatScope(projectId)) return;
    writeStoredIdeProjectId(projectId);
  }, [projectId]);

  const onProjectChange = useCallback((next: string | null) => {
    if (activePath && fileContent !== originalContent) {
      if (!window.confirm('You have unsaved edits in this file. Discard changes and switch project?')) {
        return;
      }
    }
    openFileAbortRef.current?.abort();
    openFileGenerationRef.current += 1;
    const id = next ?? IDE_FREE_CHAT_SCOPE;
    if (isIdeFreeChatScope(id)) {
      markExplicitFreeChatSelection();
      setMode('direct');
      writeStoredIdeChatMode(id, 'direct');
    } else {
      // Free Chat's leftover Direct scope against the real project (empty thread).
      const restored = modeForProject(id);
      setMode(restored);
      writeStoredIdeChatMode(id, restored);
    }
    setProjectId(id);
    syncIdeProjectUrl(id);
  }, [activePath, fileContent, originalContent]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('nucleas.ide.chatWidth');
      if (!stored) return;
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed >= 280 && parsed <= 820) {
        setChatWidth(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useLayoutEffect(() => {
    if (!projectId || freeChat) {
      setMode('direct');
      return;
    }
    // Hydrate before IdeChatPane history fetch (same readiness idea as Free Chat
    // waiting on Direct company/model) so we do not GET with a stale mode.
    const restored = modeForProject(projectId);
    setMode(restored);
    writeStoredIdeChatMode(projectId, restored);
  }, [projectId, freeChat]);

  const onModeChange = useCallback(
    (next: IdeChatMode) => {
      if (freeChat && next !== 'direct') return;
      setMode(next);
      if (projectId && !isIdeFreeChatScope(projectId)) writeStoredIdeChatMode(projectId, next);
    },
    [projectId, freeChat]
  );

  const onChatWidthChange = useCallback((next: number) => {
    setChatWidth(next);
    try {
      window.localStorage.setItem('nucleas.ide.chatWidth', String(Math.round(next)));
    } catch {
      /* ignore */
    }
  }, []);

  const onPlanReady = useCallback((plan: IdePlanDocument | null) => {
    setActivePlan(plan);
    if (plan) setCenterView('plan');
    else setCenterView('file');
  }, []);

  const onRunActivity = useCallback((activity: IdeRunActivity) => {
    setRunActivity(activity);
  }, []);

  const dirty = activePath != null && fileContent !== originalContent;
  const hasBinding = Boolean(repository?.repository) && !freeChat;

  const fetchTreePath = useCallback(
    async (path: string): Promise<TreeEntry[] | null> => {
      if (!projectId || freeChat || !hasBinding) return null;
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/ai/ide/tree?path=${encodeURIComponent(path)}`,
        { cache: 'no-store' }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Unable to load tree.');
      if (!body.ok) {
        throw new Error(body.reason ?? 'Unable to load tree.');
      }
      if (path === '') {
        setTreeBranch(body.branch ?? null);
      }
      return (body.entries ?? []) as TreeEntry[];
    },
    [projectId, freeChat, hasBinding]
  );

  const loadRoot = useCallback(async () => {
    if (!projectId || freeChat || !hasBinding) {
      setRootEntries([]);
      setChildrenByPath({});
      setExpandedPaths({});
      setLoadingPaths({});
      setTreeReason(
        freeChat
          ? 'Free Chat has no project files. Pick a project to browse a linked repo.'
          : 'Link a GitHub repository to load the file tree. Server GitHub App credentials and an installation are required for live files.'
      );
      setTreeBranch(null);
      return;
    }
    setTreeLoading(true);
    try {
      const entries = await fetchTreePath('');
      setRootEntries(entries ?? []);
      setTreeReason(null);
    } catch (error) {
      setRootEntries([]);
      setTreeReason(error instanceof Error ? error.message : 'Unable to load tree.');
      setTreeBranch(null);
    } finally {
      setTreeLoading(false);
    }
  }, [projectId, freeChat, hasBinding, fetchTreePath]);

  const refreshExpanded = useCallback(async () => {
    const paths = Object.keys(expandedPathsRef.current).filter((path) => expandedPathsRef.current[path]);
    if (!paths.length) {
      await loadRoot();
      return;
    }
    await loadRoot();
    const nextChildren: Record<string, TreeEntry[]> = {};
    await Promise.all(
      paths.map(async (path) => {
        try {
          const entries = await fetchTreePath(path);
          if (entries) nextChildren[path] = entries;
        } catch {
          /* leave missing; user can re-expand */
        }
      })
    );
    setChildrenByPath((current) => ({ ...current, ...nextChildren }));
  }, [loadRoot, fetchTreePath]);

  const toggleDir = useCallback(
    async (path: string) => {
      const isOpen = Boolean(expandedPathsRef.current[path]);
      if (isOpen) {
        setExpandedPaths((current) => {
          const next = { ...current };
          delete next[path];
          return next;
        });
        return;
      }
      setExpandedPaths((current) => ({ ...current, [path]: true }));
      if (childrenByPath[path]) return;
      setLoadingPaths((current) => ({ ...current, [path]: true }));
      try {
        const entries = await fetchTreePath(path);
        if (entries) {
          setChildrenByPath((current) => ({ ...current, [path]: entries }));
          setTreeReason(null);
        }
      } catch (error) {
        setExpandedPaths((current) => {
          const next = { ...current };
          delete next[path];
          return next;
        });
        setTreeReason(error instanceof Error ? error.message : 'Unable to load folder.');
      } finally {
        setLoadingPaths((current) => {
          const next = { ...current };
          delete next[path];
          return next;
        });
      }
    },
    [childrenByPath, fetchTreePath]
  );

  const loadSpend = useCallback(async (id: string | null, asFreeChat: boolean) => {
    try {
      const url = asFreeChat
        ? '/api/ai/ide/free-chat/spend'
        : `/api/projects/${encodeURIComponent(id!)}/ai/ide/spend`;
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Unable to load spend.');
      setSpend({
        dailyEstimatedMicros: Number(body.dailyEstimatedMicros) || 0,
        monthlyEstimatedMicros: Number(body.monthlyEstimatedMicros) || 0,
        orgMonthlyEstimatedMicros: Number(body.orgMonthlyEstimatedMicros) || 0,
        searchApiEstimatedMicros: Number(body.searchApiEstimatedMicros) || 0,
        freeChat: asFreeChat,
      });
    } catch {
      setSpend(null);
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    openFileAbortRef.current?.abort();
    openFileGenerationRef.current += 1;
    skipLayoutWriteRef.current = true;
    const layout = freeChat ? null : readStoredIdeLayout(projectId);
    setActivePath(null);
    setFileContent('');
    setOriginalContent('');
    setFileSha(null);
    setActivePlan(null);
    setChildrenByPath({});
    setLoadingPaths({});
    if (layout) {
      setTreeCollapsed(layout.treeCollapsed);
      setExpandedPaths(layout.expandedPaths);
      setRulesOpen(layout.rulesOpen);
      setCenterView(layout.centerView === 'plan' ? 'plan' : 'file');
      restorePathRef.current = layout.activePath;
    } else {
      setTreeCollapsed(false);
      setExpandedPaths({});
      setRulesOpen(false);
      setCenterView('file');
      restorePathRef.current = null;
    }
    void loadRoot().finally(() => {
      skipLayoutWriteRef.current = false;
    });
  }, [projectId, hasBinding, loadRoot, freeChat]);

  // Reopen last file after tree/binding is ready (fresh from API — no dirty buffer).
  useEffect(() => {
    const path = restorePathRef.current;
    if (!path || !projectId || freeChat || !hasBinding || treeLoading) return;
    restorePathRef.current = null;
    void openFile(path);
    // openFile is stable enough for restore; avoid depending on its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, freeChat, hasBinding, treeLoading, rootEntries]);

  useEffect(() => {
    if (!projectId || freeChat || skipLayoutWriteRef.current) return;
    writeStoredIdeLayout(projectId, {
      treeCollapsed,
      expandedPaths,
      activePath,
      rulesOpen,
      centerView,
    });
  }, [projectId, freeChat, treeCollapsed, expandedPaths, activePath, rulesOpen, centerView]);

  useEffect(() => {
    if (!projectId) {
      setSpend(null);
      return;
    }
    void loadSpend(freeChat ? null : projectId, freeChat);
  }, [projectId, freeChat, loadSpend]);

  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = runActivity.busy;
    if (wasBusy && !runActivity.busy && projectId) {
      void loadSpend(freeChat ? null : projectId, freeChat);
    }
  }, [runActivity.busy, projectId, freeChat, loadSpend]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  async function openFile(path: string) {
    if (!projectId || freeChat) return;
    if (dirty && activePath && activePath !== path) {
      if (!window.confirm(`You have unsaved changes in ${activePath}. Discard changes and open ${path}?`)) {
        return;
      }
    }
    const currentProjectId = projectId;
    openFileAbortRef.current?.abort();
    const controller = new AbortController();
    openFileAbortRef.current = controller;
    const generation = ++openFileGenerationRef.current;

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(currentProjectId)}/ai/ide/file?path=${encodeURIComponent(path)}`,
        { cache: 'no-store', signal: controller.signal }
      );
      const body = await response.json();
      if (generation !== openFileGenerationRef.current || controller.signal.aborted) return;
      if (currentProjectId !== projectId) return;

      if (!response.ok || !body.ok) {
        setTreeReason(body.reason ?? body.error ?? 'Unable to open file.');
        return;
      }
      setActivePath(body.path);
      setFileContent(body.content ?? '');
      setOriginalContent(body.content ?? '');
      setFileSha(body.sha ?? null);
      setCenterView('file');
    } catch (error) {
      if (controller.signal.aborted) return;
      setTreeReason(error instanceof Error ? error.message : 'Unable to open file.');
    }
  }

  async function rejectPlan() {
    await rejectPlanRef.current?.();
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
        <h1 className="text-sm font-semibold text-text-primary">IDE</h1>
        <IdeProjectRepoSwitcher
          projectId={projectId}
          onProjectChange={onProjectChange}
          onRepositoryChange={setRepository}
        />
        {activePlan ? (
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
            onClick={() => setCenterView((current) => (current === 'plan' ? 'file' : 'plan'))}
          >
            {centerView === 'plan' ? 'Show file' : 'Show plan'}
          </button>
        ) : null}
        {spend ? (
          <p
            className="font-mono text-[11px] text-text-secondary"
            title="Estimated AI spend (UTC). Org is the organization ledger, not a sum of projects. Search APIs are Brave/CSE estimates after free tiers."
          >
            {spend.freeChat ? (
              <>
                Free Chat month {formatSpend(spend.monthlyEstimatedMicros)} · Org month{' '}
                {formatSpend(spend.orgMonthlyEstimatedMicros)}
              </>
            ) : (
              <>
                Today {formatSpend(spend.dailyEstimatedMicros)} · Project month{' '}
                {formatSpend(spend.monthlyEstimatedMicros)} · Org month{' '}
                {formatSpend(spend.orgMonthlyEstimatedMicros)}
              </>
            )}
            {' · '}
            Search APIs {formatSpend(spend.searchApiEstimatedMicros)}
          </p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <IdeFileTree
          collapsed={treeCollapsed}
          onToggle={() => setTreeCollapsed((value) => !value)}
          rootEntries={rootEntries}
          childrenByPath={childrenByPath}
          expandedPaths={expandedPaths}
          loadingPaths={loadingPaths}
          loading={treeLoading}
          reason={treeReason}
          branch={treeBranch}
          activePath={activePath}
          onOpenFile={(path) => void openFile(path)}
          onToggleDir={(path) => void toggleDir(path)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            {centerView === 'plan' && activePlan ? (
              <IdePlanPane
                plan={activePlan}
                approveDisabled={runActivity.busy}
                onChange={setActivePlan}
                onReject={rejectPlan}
                onApprove={() => {
                  if (!activePlan) return;
                  approvePlanRef.current?.(activePlan);
                }}
              />
            ) : (
              <>
                <IdeEditor
                  path={activePath}
                  content={fileContent}
                  dirty={dirty}
                  readOnlyReason={null}
                  onChange={setFileContent}
                />
                <IdePublishApproval
                  projectId={freeChat ? null : projectId}
                  canPublish={Boolean(repository?.canManage) && !freeChat}
                  path={activePath}
                  originalContent={originalContent}
                  content={fileContent}
                  expectedSha={fileSha}
                  dirty={dirty}
                  onPublished={() => {
                    if (activePath) {
                      setOriginalContent(fileContent);
                      void refreshExpanded();
                    }
                  }}
                />
              </>
            )}
          </div>
          <IdeRunScene activity={runActivity} />
        </div>
        <IdeChatPane
          projectId={projectId}
          chatScopeReady={Boolean(projectId)}
          mode={mode}
          onModeChange={onModeChange}
          onOpenRules={freeChat ? undefined : () => setRulesOpen(true)}
          width={chatWidth}
          onWidthChange={onChatWidthChange}
          onPlanReady={onPlanReady}
          onRunActivity={onRunActivity}
          approvePlanRef={approvePlanRef}
          rejectPlanRef={rejectPlanRef}
        />
      </div>
      {!freeChat ? (
        <IdeTaskRulesPanel projectId={projectId} open={rulesOpen} onClose={() => setRulesOpen(false)} />
      ) : null}
    </div>
  );
}
