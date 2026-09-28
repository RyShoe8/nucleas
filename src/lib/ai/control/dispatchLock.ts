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
