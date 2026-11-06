import 'server-only';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { Job, JobRun, type JobRunProgressStage } from '@/lib/models/Job';
import { getAppBaseUrl } from '@/lib/utils/appBaseUrl';

/** Long enough for a slow upstream call; renewed independently of visible progress. */
export const JOB_RUN_LEASE_MS = 20 * 60 * 1000;
export const JOB_RUN_HEARTBEAT_MS = 60 * 1000;

export function leaseExpiry(now = new Date()): Date {
  return new Date(now.getTime() + JOB_RUN_LEASE_MS);
}

export function initialRunLease(owner?: string, now = new Date()) {
  return {
    attempt: 1,
    ...(owner ? { leaseOwner: owner.slice(0, 160), executionStartedAt: now } : {}),
    heartbeatAt: now,
    leaseExpiresAt: leaseExpiry(now),
  };
}

/**
 * Atomically gives one executor a run. A second delivery is ignored while the lease is live;
 * an expired executor can be replaced without creating another run or losing its history.
 */
export async function claimJobRunExecution(runId: string): Promise<{ run: { _id: Types.ObjectId; jobId: Types.ObjectId; dryRun: boolean; status: string }; owner: string } | null> {
  if (!Types.ObjectId.isValid(runId)) return null;
  const now = new Date();
  const owner = `nucleas:${randomUUID()}`;
  const first = await JobRun.findOneAndUpdate(
    { _id: new Types.ObjectId(runId), status: 'running', executionStartedAt: { $exists: false } },
    { $set: { leaseOwner: owner, executionStartedAt: now, heartbeatAt: now, leaseExpiresAt: leaseExpiry(now) } },
    { new: true }
  ).lean<{ _id: Types.ObjectId; jobId: Types.ObjectId; dryRun: boolean; status: string }>();
  if (first) return { run: first, owner };

  const reclaimed = await JobRun.findOneAndUpdate(
    { _id: new Types.ObjectId(runId), status: 'running', leaseExpiresAt: { $lte: now } },
    {
      $set: { leaseOwner: owner, executionStartedAt: now, heartbeatAt: now, leaseExpiresAt: leaseExpiry(now) },
      $inc: { attempt: 1 },
      $push: { progress: { $each: ['Recovered an interrupted run'], $slice: -40 } },
    },
    { new: true }
  ).lean<{ _id: Types.ObjectId; jobId: Types.ObjectId; dryRun: boolean; status: string }>();
  return reclaimed ? { run: reclaimed, owner } : null;
}

export async function heartbeatJobRun(
  runId: Types.ObjectId,
  owner: string,
  progress?: { text: string; milestone?: { stage: JobRunProgressStage; percent: number } }
): Promise<boolean> {
  const now = new Date();
  const update = {
    $set: {
      heartbeatAt: now,
      leaseExpiresAt: leaseExpiry(now),
      ...(progress?.milestone ? {
        'progressState.stage': progress.milestone.stage,
        'progressState.label': progress.text.slice(0, 300),
        'progressState.updatedAt': now,
      } : {}),
    },
    ...(progress?.milestone ? { $max: { 'progressState.percent': progress.milestone.percent } } : {}),
    ...(progress?.text ? { $push: { progress: { $each: [progress.text.slice(0, 300)], $slice: -40 } } } : {}),
  };
  const result = await JobRun.updateOne({ _id: runId, status: 'running', leaseOwner: owner }, update);
  return result.matchedCount === 1;
}

export function startJobRunHeartbeat(runId: Types.ObjectId, owner: string): ReturnType<typeof setInterval> {
  const timer = setInterval(() => void heartbeatJobRun(runId, owner).catch(() => undefined), JOB_RUN_HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}

const QUEUE_LEASE_MS = 24 * 60 * 60 * 1000;

/**
 * One research job runs at a time, because they share the free model and each can take many minutes. A later run gives up
 * its claim and waits, using no server time. Its lease is long, so the stuck-run sweep leaves it alone for a day.
 * Returns true when this run was queued and should stop for now.
 */
export async function queueIfBusy(runId: Types.ObjectId, now = new Date()): Promise<boolean> {
  const me = await JobRun.findOneAndUpdate({ _id: runId }, { $set: { queueSlot: true } }, { new: true }).select('queuedAt').lean<{ queuedAt?: Date }>();
  const first = await JobRun.findOne({ status: 'running', queueSlot: true, leaseExpiresAt: { $gt: now }, executionStartedAt: { $exists: true } })
    .sort({ executionStartedAt: 1, _id: 1 }).select('_id jobId').lean<{ _id: Types.ObjectId; jobId: Types.ObjectId }>();
  if (!first || first._id.equals(runId)) {
    await JobRun.updateOne({ _id: runId }, { $unset: { queuedAt: '' } });
    return false;
  }
  const ahead = await Job.findById(first.jobId).select('design.title').lean<{ design?: { title?: string } }>();
  const label = `Queued: starts when ${ahead?.design?.title ?? 'the job ahead of it'} finishes`;
  await JobRun.updateOne({ _id: runId }, {
    $set: { queuedAt: me?.queuedAt ?? now, leaseExpiresAt: new Date(now.getTime() + QUEUE_LEASE_MS), progressState: { stage: 'preparing', label: label.slice(0, 300), percent: 0, updatedAt: now } },
    $unset: { leaseOwner: '', executionStartedAt: '', queueSlot: '' },
    $push: { progress: { $each: [label.slice(0, 300)], $slice: -40 } },
  });
  return true;
}

/** The run that has waited longest. */
export async function nextQueuedRunId(): Promise<string | null> {
  const next = await JobRun.findOne({ status: 'running', queuedAt: { $exists: true }, executionStartedAt: { $exists: false } }).sort({ queuedAt: 1, _id: 1 }).select('_id').lean<{ _id: Types.ObjectId }>();
  return next ? String(next._id) : null;
}

/** Asks for the next queued run to start in a fresh process, so it gets its full time. The cron picks it up if this is lost. */
export async function wakeJobQueue(fetcher: typeof fetch = fetch): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !(await nextQueuedRunId())) return;
  try {
    // The next run takes minutes, so this only waits long enough for the request to be received.
    await fetcher(`${getAppBaseUrl()}/api/cron/job-queue`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(4000) });
  } catch (error) {
    if (!(error instanceof Error && error.name === 'TimeoutError')) console.warn('[jobs] could not wake the job queue; the cron will start it', error instanceof Error ? error.message : 'unknown');
  }
}
