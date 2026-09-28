import 'server-only';
import { Types } from 'mongoose';
import type { IdeChatMode } from '@/lib/ide/modes';
import { isIdeDirectMode, storedModeValues } from '@/lib/ide/modes';
import type { IdePlanDocument } from '@/lib/ide/idePlan';
import { AiIdeChatTurn } from '@/lib/models/AiIdeChatTurn';
import { isMongoDuplicateKeyError } from '@/lib/utils/mongoErrors';
import type { RepositoryEvidenceReceipt } from '@/lib/ai/evidenceReceipts';

const HISTORY_LIMIT = 50;

let indexesReady: Promise<void> | undefined;

/** Best-effort; never throw to callers. */
function ensureIdeChatIndexes(): Promise<void> {
  indexesReady ??= AiIdeChatTurn.createIndexes()
    .then(() => undefined)
    .catch(() => {
      indexesReady = undefined;
    });
  return indexesReady;
}

export type IdePersistedTurn = {
  requestId: string;
  role: 'user' | 'assistant' | 'status';
  text: string;
  failureCategory?: string | null;
  debugHint?: string | null;
  runId?: string | null;
  costMicros?: number | null;
  reservedMicros?: number | null;
  noProviderFee?: boolean;
  toolsUsed?: string[];
  artifacts?: { kind: 'image'; assetId: string; name: string; url: string }[];
  evidenceReceipts?: RepositoryEvidenceReceipt[];
  plan?: IdePlanDocument | null;
  createdAt?: string | null;
};

export function ideThreadKeys(input: {
  mode: IdeChatMode;
  modelProfileId?: string;
  model?: string;
}): { mode: IdeChatMode; directProfileId: string; directModel: string } {
  if (!isIdeDirectMode(input.mode)) {
    return { mode: input.mode, directProfileId: '', directModel: '' };
  }
  return {
    mode: 'direct',
    directProfileId: input.modelProfileId?.trim() ?? '',
    directModel: input.model?.trim() ?? '',
  };
}

function mapPlan(plan: unknown): IdePlanDocument | null {
  if (!plan || typeof plan !== 'object') return null;
  const row = plan as Record<string, unknown>;
  const title = typeof row.title === 'string' ? row.title : '';
  const summary = typeof row.summary === 'string' ? row.summary : '';
  const markdown = typeof row.markdown === 'string' ? row.markdown : '';
  const status = row.status;
  if (!title || !markdown) return null;
  if (status !== 'ready_for_review' && status !== 'approved' && status !== 'building') return null;
  const steps = Array.isArray(row.steps)
    ? row.steps.filter((item): item is string => typeof item === 'string')
    : [];
  return { title, summary, steps, markdown, status };
}

function toInsertDocs(
  input: {
    organizationId: string;
    projectId: Types.ObjectId;
    userId: string;
    mode: IdeChatMode;
    modelProfileId?: string;
    model?: string;
    turns: IdePersistedTurn[];
  },
  options: { includePlan: boolean }
) {
  const keys = ideThreadKeys(input);
  return input.turns.map((turn) => ({
    organizationId: input.organizationId,
    projectId: input.projectId,
    createdByUserId: new Types.ObjectId(input.userId),
    mode: keys.mode,
    directProfileId: keys.directProfileId,
    directModel: keys.directModel,
    requestId: turn.requestId,
    role: turn.role,
    text: (turn.text || ' ').slice(0, 24000),
    ...(turn.failureCategory ? { failureCategory: turn.failureCategory } : {}),
    ...(turn.debugHint ? { debugHint: turn.debugHint.slice(0, 400) } : {}),
    ...(turn.runId ? { runId: turn.runId } : {}),
    ...(turn.costMicros != null ? { costMicros: turn.costMicros } : {}),
    ...(turn.reservedMicros != null ? { reservedMicros: turn.reservedMicros } : {}),
    ...(turn.noProviderFee != null ? { noProviderFee: turn.noProviderFee } : {}),
    ...(turn.toolsUsed?.length ? { toolsUsed: turn.toolsUsed.slice(0, 20) } : {}),
    ...(turn.artifacts?.length
      ? {
          artifacts: turn.artifacts.slice(0, 8).map((item) => ({
            kind: 'image' as const,
            assetId: item.assetId.slice(0, 64),
            name: item.name.slice(0, 200),
            url: item.url.slice(0, 4000),
          })),
        }
      : {}),
    ...(turn.evidenceReceipts?.length
      ? { evidenceReceipts: turn.evidenceReceipts.slice(0, 50) }
      : {}),
    ...(options.includePlan && turn.plan
      ? {
          plan: {
            title: turn.plan.title.slice(0, 200),
            summary: (turn.plan.summary || ' ').slice(0, 2000),
            steps: turn.plan.steps.slice(0, 40).map((step) => step.slice(0, 500)),
            markdown: turn.plan.markdown.slice(0, 24000),
            status: turn.plan.status,
          },
        }
      : {}),
  }));
}

export async function loadIdeChatHistory(input: {
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  mode: IdeChatMode;
  modelProfileId?: string;
  model?: string;
  limit?: number;
}): Promise<IdePersistedTurn[]> {
  const keys = ideThreadKeys(input);
  if (isIdeDirectMode(keys.mode) && (!keys.directProfileId || !keys.directModel)) {
    return [];
  }
  await ensureIdeChatIndexes();
  const limit = Math.min(Math.max(input.limit ?? HISTORY_LIMIT, 1), 100);
  // Orchestrated includes transcripts from the old AI Team tabs. Direct scopes by credential/model.
  const filter = isIdeDirectMode(keys.mode)
    ? {
        organizationId: input.organizationId,
        projectId: input.projectId,
        createdByUserId: new Types.ObjectId(input.userId),
        mode: keys.mode,
        directProfileId: keys.directProfileId,
        directModel: keys.directModel,
      }
    : {
        organizationId: input.organizationId,
        projectId: input.projectId,
        createdByUserId: new Types.ObjectId(input.userId),
        mode: { $in: storedModeValues(keys.mode) },
      };
  const rows = await AiIdeChatTurn.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .maxTimeMS(3000)
    .lean();

  return rows
    .reverse()
    .map((row) => ({
      requestId: row.requestId,
      role: row.role as IdePersistedTurn['role'],
      text: row.text,
      failureCategory: row.failureCategory ?? null,
      debugHint: row.debugHint ?? null,
      runId: row.runId ?? null,
      costMicros: row.costMicros ?? null,
      reservedMicros: row.reservedMicros ?? null,
      noProviderFee: row.noProviderFee ?? false,
      toolsUsed: row.toolsUsed ?? [],
      artifacts: (row.artifacts ?? []).map((item) => ({
        kind: 'image' as const,
        assetId: item.assetId,
        name: item.name,
        url: item.url,
      })),
      evidenceReceipts: (row.evidenceReceipts ?? []) as RepositoryEvidenceReceipt[],
      plan: mapPlan(row.plan),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    }));
}

/**
 * Persist turns. Returns whether at least one write attempt succeeded.
 * Retries without embedded plan if the first insert fails (plan validation).
 */
export async function appendIdeChatTurns(input: {
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  mode: IdeChatMode;
  modelProfileId?: string;
  model?: string;
  turns: IdePersistedTurn[];
}): Promise<boolean> {
  const keys = ideThreadKeys(input);
  if (!input.turns.length) return true;
  if (isIdeDirectMode(keys.mode) && (!keys.directProfileId || !keys.directModel)) return false;

  await ensureIdeChatIndexes();

  const attempts = [
    toInsertDocs(input, { includePlan: true }),
    toInsertDocs(input, { includePlan: false }),
  ];

  let lastError: unknown;
  for (const docs of attempts) {
    try {
      const inserted = await AiIdeChatTurn.insertMany(docs, { ordered: false });
      if (Array.isArray(inserted) && inserted.length === docs.length) {
        return true;
      }
      if (typeof AiIdeChatTurn.countDocuments === 'function') {
        const requestIds = docs.map((d) => d.requestId);
        const count = await AiIdeChatTurn.countDocuments({
          organizationId: input.organizationId,
          projectId: input.projectId,
          requestId: { $in: requestIds },
        });
        if (count === docs.length) return true;
        lastError = new Error(`Partial insert: expected ${docs.length}, found ${count}`);
      } else {
        lastError = new Error(`Expected ${docs.length} documents inserted, got ${Array.isArray(inserted) ? inserted.length : 0}`);
      }
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        if (typeof AiIdeChatTurn.countDocuments === 'function') {
          const requestIds = docs.map((d) => d.requestId);
          const count = await AiIdeChatTurn.countDocuments({
            organizationId: input.organizationId,
            projectId: input.projectId,
            requestId: { $in: requestIds },
          });
          if (count === docs.length) return true;
        } else {
          return true;
        }
      }
      lastError = error;
    }
  }

  console.error('[ide-chat-history] persist failed', {
    organizationId: input.organizationId,
    projectId: String(input.projectId),
    mode: keys.mode,
    turnCount: input.turns.length,
    error: lastError,
  });
  return false;
}

/** Permanently remove an embedded plan from a persisted turn (reject). */
export async function clearIdeChatTurnPlan(input: {
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  requestId: string;
}): Promise<boolean> {
  const requestId = input.requestId.trim();
  if (!requestId) return false;
  await ensureIdeChatIndexes();
  const result = await AiIdeChatTurn.updateOne(
    {
      organizationId: input.organizationId,
      projectId: input.projectId,
      createdByUserId: new Types.ObjectId(input.userId),
      requestId,
    },
    { $unset: { plan: 1 } }
  );
  return (result.matchedCount ?? 0) > 0;
}

/** Find an already-persisted assistant turn for this request ID (idempotent retries). */
export async function findExistingIdeAssistantTurn(input: {
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  requestId: string;
}): Promise<IdePersistedTurn | null> {
  const requestId = input.requestId.trim();
  if (!requestId) return null;
  await ensureIdeChatIndexes();
  const row = await AiIdeChatTurn.findOne({
    organizationId: input.organizationId,
    projectId: input.projectId,
    createdByUserId: new Types.ObjectId(input.userId),
    requestId,
    role: 'assistant',
  })
    .maxTimeMS(3000)
    .lean();
  if (!row) return null;
  return {
    requestId: row.requestId,
    role: 'assistant',
    text: row.text,
    failureCategory: row.failureCategory ?? null,
    debugHint: row.debugHint ?? null,
    runId: row.runId ?? null,
    costMicros: row.costMicros ?? null,
    reservedMicros: row.reservedMicros ?? null,
    noProviderFee: row.noProviderFee ?? false,
    toolsUsed: row.toolsUsed ?? [],
    artifacts: (row.artifacts ?? []).map((item) => ({
      kind: 'image' as const,
      assetId: item.assetId,
      name: item.name,
      url: item.url,
    })),
    evidenceReceipts: (row.evidenceReceipts as RepositoryEvidenceReceipt[] | undefined) ?? [],
    plan: mapPlan(row.plan),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
}

