import 'server-only';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { JobRun, type JobRunProgressStage } from '@/lib/models/Job';

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
