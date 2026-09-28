import 'server-only';
import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { CapabilityInvocation } from '@/lib/models/Capability';
import { BuildRequest } from '@/lib/models/BuildRequest';
import { getCompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';
import { resolveCompanyRepository } from '@/lib/building/companyCode';
import { recentCommits } from '@/lib/ai/repo/history';

/**
 * What changed for a company, newest first, in one timeline: code commits, builds, actions Nucleas
 * took in connected systems, and integration changes. Built from the records each of those already
 * keeps; only changes with no record of their own are stored here (ActivityEvent).
 */

export const ACTIVITY_KINDS = ['code', 'build', 'action', 'integration', 'company'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

const eventSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
    kind: { type: String, enum: ACTIVITY_KINDS, required: true },
    title: { type: String, required: true, maxlength: 300 },
    detail: { type: String, maxlength: 1000 },
    actorUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: false }
);
eventSchema.index({ organizationId: 1, companyId: 1, at: -1 });

type EventDoc = InferSchemaType<typeof eventSchema>;
export const ActivityEvent: Model<EventDoc> =
  (mongoose.models.ActivityEvent as Model<EventDoc> | undefined) ?? mongoose.model<EventDoc>('ActivityEvent', eventSchema);

/** Records a change that has no record of its own. Best effort: never fails the caller. */
export async function recordActivity(input: {
  organizationId: Types.ObjectId | string;
  companyId: Types.ObjectId | string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  actorUserId?: string;
}): Promise<void> {
  if (mongoose.connection.readyState !== 1 || !Types.ObjectId.isValid(String(input.companyId))) return;
  await ActivityEvent.create({
    organizationId: new Types.ObjectId(String(input.organizationId)),
    companyId: new Types.ObjectId(String(input.companyId)),
    at: new Date(),
    kind: input.kind,
    title: input.title.slice(0, 300),
    ...(input.detail ? { detail: input.detail.slice(0, 1000) } : {}),
    ...(input.actorUserId && Types.ObjectId.isValid(input.actorUserId) ? { actorUserId: new Types.ObjectId(input.actorUserId) } : {}),
  }).catch(() => undefined);
}

export interface ActivityItem {
  at: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  by?: string;
}

const BUILD_ACTION_LABEL: Record<string, string> = {
  proposed: 'plan proposed',
  edited: 'plan edited',
  approved: 'approved for building',
  rejected: 'plan rejected',
  started: 'build started',
  built: 'built, ready for review',
  failed: 'build failed',
  timed_out: 'build timed out',
  retried: 'rebuild requested',
  discarded: 'discarded',
  pr_opened: 'pull request opened',
  pr_failed: 'pull request failed',
};

// Commit lists per repository are reused briefly, so every Ask message does not call GitHub.
const commitCache = new Map<string, { at: number; items: ActivityItem[] }>();

async function codeItems(viewer: CompanyViewer, companyId: string, limit: number): Promise<ActivityItem[]> {
  const target = await resolveCompanyRepository(viewer, companyId).catch(() => null);
  if (!target) return [];
  const key = `${target.repository.fullName}:${limit}`;
  const cached = commitCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.items;
  const history = await recentCommits(String(viewer.organizationId), target.projectId, { count: limit }).catch(() => null);
  if (!history?.ok) return [];
  const items = history.commits.map((c) => {
    const files = c.files.map((f) => f.path);
    return {
      at: c.date ?? new Date(0).toISOString(),
      kind: 'code' as const,
      title: `${c.message.split('\n')[0].slice(0, 160)} (${c.sha.slice(0, 7)})`,
      detail: files.length ? `${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 6).join(', ')}${files.length > 6 ? ', …' : ''}` : undefined,
      by: c.author || undefined,
    };
  });
  commitCache.set(key, { at: Date.now(), items });
  return items;
}

/** The company's recent changes across code, builds, actions and integrations, newest first. */
export async function companyTimeline(viewer: CompanyViewer, companyId: string, options: { limit?: number; includeCode?: boolean } = {}): Promise<ActivityItem[] | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const cid = new Types.ObjectId(profile.id);

  const [actions, builds, events, code] = await Promise.all([
    CapabilityInvocation.find({ organizationId: viewer.organizationId, companyId: cid, kind: 'write' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('capabilityId status summary error createdAt')
      .lean<{ capabilityId: string; status: string; summary?: string; error?: string; createdAt: Date }[]>(),
    BuildRequest.find({ organizationId: viewer.organizationId, companyId: cid })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('title events repository pullRequest')
      .lean<{ title: string; events?: { at: Date; action: string; note?: string }[]; pullRequest?: { url?: string } }[]>(),
    ActivityEvent.find({ organizationId: viewer.organizationId, companyId: cid })
      .sort({ at: -1 })
      .limit(limit)
      .lean<{ at: Date; kind: ActivityKind; title: string; detail?: string }[]>(),
    options.includeCode === false ? Promise.resolve([]) : codeItems(viewer, profile.id, limit),
  ]);

  const items: ActivityItem[] = [
    ...actions.map((a) => ({
      at: a.createdAt.toISOString(),
      kind: 'action' as const,
      title: `${a.capabilityId}: ${a.status.replace('_', ' ')}`,
      detail: a.summary ?? a.error,
    })),
    ...builds.flatMap((b) =>
      (b.events ?? []).map((e) => ({
        at: new Date(e.at).toISOString(),
        kind: 'build' as const,
        title: `Build "${b.title}": ${BUILD_ACTION_LABEL[e.action] ?? e.action}`,
        detail: e.action === 'pr_opened' ? b.pullRequest?.url : e.note,
      }))
    ),
    ...events.map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, title: e.title, detail: e.detail })),
    ...code,
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Compact lines for model context. */
export function renderTimeline(items: ActivityItem[]): string {
  return items
    .map((i) => `- ${i.at.slice(0, 16).replace('T', ' ')} [${i.kind}] ${i.title}${i.by ? ` — ${i.by}` : ''}${i.detail ? ` (${i.detail.slice(0, 200)})` : ''}`)
    .join('\n');
}
