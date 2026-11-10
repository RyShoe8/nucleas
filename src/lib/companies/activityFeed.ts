import 'server-only';
import { Types } from 'mongoose';
import { CapabilityInvocation } from '@/lib/models/Capability';
import { Job, JobRun } from '@/lib/models/Job';
import { PublishDelivery } from '@/lib/models/Publishing';
import { getCompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';
import { companyTimeline } from '@/lib/companies/activityLog';
import { TEAM, teamRoleFor, type TeamRole } from '@/lib/companies/teamRoles';

/**
 * Everything that happened for one company as a single list, newest first: what the team ran,
 * posted and waited on, what people decided, and what changed in code and connections.
 * Read-only and built from records each area already keeps.
 */
export type FeedKind = 'work' | 'post' | 'decision' | 'build' | 'code' | 'setup' | 'sync';
export type FeedTone = 'ok' | 'attention' | 'failed' | 'running' | 'neutral';

export interface FeedItem {
  id: string;
  at: string;
  kind: FeedKind;
  tone: FeedTone;
  title: string;
  /** The responsibility, build or system this belongs to. */
  subject?: string;
  detail?: string;
  member?: string;
  jobId?: string;
  url?: string;
  /** Items next to each other with the same key are the same thing repeating (an hourly check). */
  repeatKey?: string;
}

const EVENT_LABEL: Record<string, string> = {
  requested: 'Handed to the team',
  proposed: 'Plan ready for approval',
  approved: 'Plan approved',
  rejected: 'Plan rejected',
  ready: 'Ready to run',
  paused: 'Paused',
  resumed: 'Resumed',
  archived: 'Archived',
  renamed: 'Renamed',
  run_started: 'Run started by a person',
  dry_run_accepted: 'Test run accepted',
  responsibility_edited: 'Brief edited; needs approval again',
  team_assigned: 'Owner changed',
  budget_updated: 'Monthly budget changed',
  skill_configured: 'Settings changed',
  generated_from_plan: 'Created from the marketing plan',
  sample_auto_scheduled: 'Schedule started after the test run',
};

const PLATFORM: Record<string, string> = { reddit: 'Reddit', facebook: 'Facebook', bluesky: 'Bluesky', admin: 'the site admin', wordpress: 'the website' };

function sentence(action: string): string {
  const text = action.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clip(text: string | undefined | null, max = 240): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim();
  return clean ? (clean.length > max ? `${clean.slice(0, max - 1)}…` : clean) : undefined;
}

export async function companyActivityFeed(viewer: CompanyViewer, companyId: string, options: { days?: number; limit?: number } = {}): Promise<FeedItem[] | null> {
  const profile = await getCompanyProfile(viewer, companyId);
  if (!profile) return null;
  // Hourly checks add up fast; the screen folds repeats, so fetch enough to cover the whole range.
  const limit = Math.min(Math.max(options.limit ?? 1500, 1), 2000);
  const since = new Date(Date.now() - Math.min(Math.max(options.days ?? 14, 1), 90) * 86_400_000);
  const scope = { organizationId: viewer.organizationId, companyId: new Types.ObjectId(profile.id) };

  const [jobs, runs, deliveries, syncs, timeline] = await Promise.all([
    Job.find(scope).select('teamRole request design.title design.skill design.category events teamAdvice.at teamAdvice.items.member teamAdvice.items.question').lean<{ _id: Types.ObjectId; teamRole?: string; request?: string; design?: { title?: string; skill?: string; category?: string }; events?: { at: Date; action: string; note?: string }[]; teamAdvice?: { at?: Date; items?: { member: TeamRole; question: string }[] } }[]>(),
    JobRun.find({ ...scope, updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(limit)
      .select('jobId dryRun status startedAt finishedAt error decisionNote costMicros output.summary output.records')
      .lean<{ _id: Types.ObjectId; jobId: Types.ObjectId; dryRun?: boolean; status: string; startedAt: Date; finishedAt?: Date; error?: string; decisionNote?: string; costMicros?: number; output?: { summary?: string; records?: unknown[] } }[]>(),
    PublishDelivery.find({ ...scope, status: { $in: ['posted', 'failed'] }, updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(limit)
      .select('jobId platform mode status title postedUrl postedAt error updatedAt')
      .lean<{ _id: Types.ObjectId; jobId: Types.ObjectId; platform: string; mode: string; status: string; title?: string; postedUrl?: string; postedAt?: Date; error?: string; updatedAt: Date }[]>(),
    CapabilityInvocation.find({ ...scope, kind: { $ne: 'write' }, status: { $nin: ['succeeded', 'running'] }, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(100)
      .select('capabilityId status summary error createdAt')
      .lean<{ _id: Types.ObjectId; capabilityId: string; status: string; summary?: string; error?: string; createdAt: Date }[]>(),
    companyTimeline(viewer, profile.id, { limit: 100 }),
  ]);

  const jobById = new Map(jobs.map((job) => [String(job._id), { title: job.design?.title ?? clip(job.request, 80) ?? 'Responsibility', member: TEAM[teamRoleFor(job) as TeamRole].name }]));
  const items: FeedItem[] = [];

  for (const run of runs) {
    const job = jobById.get(String(run.jobId));
    if (!job) continue;
    const test = run.dryRun ? 'Test run' : 'Run';
    const found = run.output?.records?.length;
    const base = { subject: job.title, member: job.member, jobId: String(run.jobId), kind: 'work' as const };
    const id = `run:${run._id}`;
    const at = (run.finishedAt ?? run.startedAt).toISOString();
    if (run.status === 'running') items.push({ ...base, id, at: run.startedAt.toISOString(), tone: 'running', title: `${test} in progress` });
    else if (run.status === 'needs_review') items.push({ ...base, id, at, tone: 'attention', title: `${test} finished and is waiting for your review`, detail: clip(run.output?.summary) });
    else if (run.status === 'failed') items.push({ ...base, id, at, tone: 'failed', title: `${test} failed`, detail: clip(run.error), repeatKey: `fail:${run.jobId}:${run.error ?? ''}` });
    else if (run.status === 'rejected') items.push({ ...base, id, at, kind: 'decision', tone: 'neutral', title: `${test} result rejected`, detail: clip(run.decisionNote) });
    else items.push({ ...base, id, at, tone: 'ok', title: found ? `${test} finished with ${found} result${found === 1 ? '' : 's'}` : `${test} finished`, detail: clip(run.decisionNote ?? run.output?.summary), repeatKey: found ? undefined : `ok:${run.jobId}:${run.dryRun ? 1 : 0}` });
  }

  for (const job of jobs) {
    const known = jobById.get(String(job._id))!;
    const asked = job.teamAdvice?.items ?? [];
    if (job.teamAdvice?.at && asked.length && new Date(job.teamAdvice.at) >= since) {
      items.push({ id: `advice:${job._id}`, at: new Date(job.teamAdvice.at).toISOString(), kind: 'work', tone: 'neutral', title: `${known.member} asked ${asked.map((item) => TEAM[item.member]?.name ?? item.member).join(' and ')} for advice`, subject: known.title, member: known.member, detail: clip(asked.map((item) => item.question).join(' · ')), jobId: String(job._id) });
    }
    for (const [index, event] of (job.events ?? []).entries()) {
      const at = new Date(event.at);
      // The scheduler starting a run is not news: the run itself is in the list.
      if (at < since || event.action === 'scheduled_run_started') continue;
      items.push({ id: `event:${job._id}:${index}`, at: at.toISOString(), kind: 'decision', tone: event.action === 'proposed' ? 'attention' : 'neutral', title: EVENT_LABEL[event.action] ?? sentence(event.action), subject: known.title, member: known.member, detail: clip(event.note), jobId: String(job._id) });
    }
  }

  for (const delivery of deliveries) {
    const job = jobById.get(String(delivery.jobId));
    const where = PLATFORM[delivery.platform] ?? delivery.platform;
    const posted = delivery.status === 'posted';
    items.push({
      id: `post:${delivery._id}`, at: (delivery.postedAt ?? delivery.updatedAt).toISOString(), kind: 'post', tone: posted ? 'ok' : 'failed',
      title: posted ? `Posted to ${where}${delivery.mode === 'manual' ? ' (marked by a person)' : ''}` : `Could not post to ${where}`,
      subject: job?.title, member: job?.member, detail: clip(posted ? delivery.title : delivery.error ?? delivery.title), jobId: String(delivery.jobId), url: posted ? delivery.postedUrl : undefined,
    });
  }

  for (const sync of syncs) {
    items.push({ id: `sync:${sync._id}`, at: sync.createdAt.toISOString(), kind: 'sync', tone: sync.status === 'failed' ? 'failed' : 'attention', title: `Data sync ${sync.status.replace(/_/g, ' ')}`, subject: sync.capabilityId, detail: clip(sync.error ?? sync.summary), repeatKey: `sync:${sync.capabilityId}:${sync.status}` });
  }

  for (const [index, entry] of (timeline ?? []).entries()) {
    if (new Date(entry.at) < since) continue;
    const kind: FeedKind = entry.kind === 'code' ? 'code' : entry.kind === 'build' ? 'build' : entry.kind === 'action' ? 'work' : 'setup';
    const failed = /failed|denied/i.test(entry.title);
    items.push({ id: `change:${entry.at}:${index}`, at: entry.at, kind, tone: failed ? 'failed' : 'neutral', title: entry.title, detail: clip([entry.by, entry.detail].filter(Boolean).join(' · ')), member: entry.kind === 'build' ? TEAM.engineering.name : undefined, url: entry.detail?.startsWith('https://') ? entry.detail : undefined });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, limit);
}
