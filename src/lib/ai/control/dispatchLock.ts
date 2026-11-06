import 'server-only';
import type { ClientSession, Types } from 'mongoose';
import { GatewayError } from '@nucleas/ai-core/gateway';
import { DISPATCH_USAGE_ID } from '@/lib/ai/control/dispatchLimits';
import { AiDispatchLock, AiRun } from '@/lib/models/AiControl';

const LIVE_RUN_STATUSES = new Set(['queued', 'running']);

/**
 * If another holder has an unexpired lock tied to a live run or without an associated run, throw unavailable.
 * Only an unexpired lock whose associated run has completed/failed/cancelled is treated as stealable.
 */
export async function assertDispatchLockClaimable(
  now: Date,
  session?: ClientSession
): Promise<void> {
  const lock = await AiDispatchLock.findById(DISPATCH_USAGE_ID).session(session ?? null);
  if (!lock || lock.expiresAt <= now) return;

  const holderRunId = lock.runId;
  if (!holderRunId) {
    throw new GatewayError('unavailable', { kind: 'dispatch_lock_held' });
  }

  const run = await AiRun.findById(holderRunId).select('status').session(session ?? null).lean();
  if (!run || !LIVE_RUN_STATUSES.has(String(run.status))) return;

  throw new GatewayError('unavailable', { kind: 'dispatch_lock_held' });
}

export async function claimDispatchLock(input: {
  token: string;
  expiresAt: Date;
  runId: Types.ObjectId;
  session?: ClientSession;
}): Promise<void> {
  await AiDispatchLock.updateOne(
    { _id: DISPATCH_USAGE_ID },
    {
      $set: {
        token: input.token,
        expiresAt: input.expiresAt,
        runId: input.runId,
      },
    },
    { upsert: true, session: input.session }
  );
}

export async function renewDispatchLock(input: {
  token: string;
  expiresAt: Date;
}): Promise<boolean> {
  const res = await AiDispatchLock.updateOne(
    { _id: DISPATCH_USAGE_ID, token: input.token },
    { $set: { expiresAt: input.expiresAt } }
  );
  return res.matchedCount > 0;
}

export async function releaseDispatchLock(token: string): Promise<void> {
  await AiDispatchLock.deleteOne({ _id: DISPATCH_USAGE_ID, token }).catch(() => undefined);
}

/**
 * On abort, shorten the lock expiry to a grace period rather than deleting immediately,
 * ensuring any in-flight remote generation drains before a new dispatch starts.
 * Returns an unsubscribe that removes the listener (e.g. after normal finish).
 */
export function watchAbortReleaseDispatchLock(
  signal: AbortSignal | undefined,
  token: string,
  graceMs = 5000
): () => void {
  if (!signal) return () => undefined;

  const onAbort = () => {
    void AiDispatchLock.updateOne(
      { _id: DISPATCH_USAGE_ID, token },
      { $set: { expiresAt: new Date(Date.now() + graceMs) } }
    ).catch(() => undefined);
  };

  if (signal.aborted) {
    onAbort();
    return () => undefined;
  }

  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

/**
 * Waits (up to maxWaitMs) until the shared lock can be claimed, instead of failing straight away
 * when another run is using the shared local model. Throws unavailable after the wait.
 */
export async function waitForDispatchLock(options: { maxWaitMs?: number; pollMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  const deadline = Date.now() + (options.maxWaitMs ?? 90_000);
  for (;;) {
    try {
      await assertDispatchLockClaimable(new Date());
      return;
    } catch (error) {
      if (!(error instanceof GatewayError) || Date.now() + (options.pollMs ?? 2000) > deadline) throw error;
    }
    if (options.signal?.aborted) throw new GatewayError('cancelled');
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 2000));
  }
}

/**
 * Runs an admission when the shared model is free, waiting its turn. Another run can take the lock in the moment after a
 * wait ends, so being beaten to it means waiting again until the time runs out. onWaiting is called once.
 */
export async function whenDispatchFree<T>(admit: () => Promise<T>, options: { maxWaitMs?: number; pollMs?: number; signal?: AbortSignal; onWaiting?: () => void } = {}): Promise<T> {
  const deadline = Date.now() + (options.maxWaitMs ?? 90_000);
  let told = false;
  for (;;) {
    try {
      if (await freeModelBusy() && !told) { told = true; options.onWaiting?.(); }
      await waitForDispatchLock({ maxWaitMs: Math.max(0, deadline - Date.now()), pollMs: options.pollMs, signal: options.signal });
      return await admit();
    } catch (error) {
      const beaten = error instanceof GatewayError && error.details?.kind === 'dispatch_lock_held';
      if (!beaten || Date.now() >= deadline) throw error;
    }
  }
}

/**
 * Holds the shared lock for work that is not an AiRun (model checks). A lock without a run id is
 * respected until it expires, so chats wait their turn; release it as soon as the work is done.
 */
export async function holdDispatchLock(token: string, ms: number): Promise<void> {
  await AiDispatchLock.updateOne(
    { _id: DISPATCH_USAGE_ID },
    { $set: { token, expiresAt: new Date(Date.now() + ms) }, $unset: { runId: '' } },
    { upsert: true }
  );
}

/** True when the shared free model is busy with other work right now (someone holds the lock). */
export async function freeModelBusy(now = new Date()): Promise<boolean> {
  try {
    await assertDispatchLockClaimable(now);
    return false;
  } catch (error) {
    if (error instanceof GatewayError) return true;
    throw error;
  }
}
