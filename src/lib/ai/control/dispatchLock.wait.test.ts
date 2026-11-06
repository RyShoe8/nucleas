import { describe, expect, it, vi } from 'vitest';
import { GatewayError } from '@nucleas/ai-core/gateway';

vi.mock('server-only', () => ({}));
const lock = vi.hoisted(() => ({ held: false }));
vi.mock('@/lib/models/AiControl', () => ({
  AiDispatchLock: { findById: () => ({ session: async () => (lock.held ? { expiresAt: new Date(Date.now() + 60_000) } : null) }) },
  AiRun: {},
}));
import { whenDispatchFree } from './dispatchLock';

const lockHeld = () => new GatewayError('unavailable', { kind: 'dispatch_lock_held' });

describe('waiting for the shared free model', () => {
  it('runs straight away when it is free, without saying it is waiting', async () => {
    lock.held = false;
    const onWaiting = vi.fn();
    await expect(whenDispatchFree(async () => 'done', { onWaiting })).resolves.toBe('done');
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('waits its turn and says so once', async () => {
    lock.held = true;
    const onWaiting = vi.fn();
    const pending = whenDispatchFree(async () => 'done', { pollMs: 5, maxWaitMs: 2000, onWaiting });
    setTimeout(() => { lock.held = false; }, 30);
    await expect(pending).resolves.toBe('done');
    expect(onWaiting).toHaveBeenCalledTimes(1);
  });

  it('waits again when another run takes the model first', async () => {
    lock.held = false;
    const admit = vi.fn<() => Promise<string>>().mockRejectedValueOnce(lockHeld()).mockResolvedValueOnce('done');
    await expect(whenDispatchFree(admit, { pollMs: 5, maxWaitMs: 2000 })).resolves.toBe('done');
    expect(admit).toHaveBeenCalledTimes(2);
  });

  it('gives up when its time runs out', async () => {
    lock.held = true;
    await expect(whenDispatchFree(async () => 'done', { pollMs: 5, maxWaitMs: 30 })).rejects.toMatchObject({ code: 'unavailable' });
    lock.held = false;
  });

  it('passes on any other failure at once', async () => {
    lock.held = false;
    const admit = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('budget'));
    await expect(whenDispatchFree(admit, { pollMs: 5, maxWaitMs: 2000 })).rejects.toThrow('budget');
    expect(admit).toHaveBeenCalledTimes(1);
  });
});
