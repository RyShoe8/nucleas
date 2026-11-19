import { describe, expect, it } from 'vitest';
import { encodeIdeChatNdjsonLine, withStage } from '@/lib/ide/ideChatStream';

describe('encodeIdeChatNdjsonLine', () => {
  it('encodes a stage event as a JSON line', () => {
    expect(encodeIdeChatNdjsonLine({ type: 'stage', stage: 'worker', status: 'start' })).toBe(
      '{"type":"stage","stage":"worker","status":"start"}\n'
    );
  });
});

describe('withStage', () => {
  it('emits start then end around the work', async () => {
    const events: Array<{ stage: string; status: string }> = [];
    const result = await withStage(
      (stage, status) => events.push({ stage, status }),
      'worker',
      async () => 'ok'
    );
    expect(result).toBe('ok');
    expect(events).toEqual([
      { stage: 'worker', status: 'start' },
      { stage: 'worker', status: 'end' },
    ]);
  });

  it('emits end even when work throws', async () => {
    const events: Array<{ stage: string; status: string }> = [];
    await expect(
      withStage(
        (stage, status) => events.push({ stage, status }),
        'reviewer',
        async () => {
          throw new Error('boom');
        }
      )
    ).rejects.toThrow('boom');
    expect(events).toEqual([
      { stage: 'reviewer', status: 'start' },
      { stage: 'reviewer', status: 'end' },
    ]);
  });

  it('works without a callback', async () => {
    await expect(withStage(undefined, 'direct', async () => 1)).resolves.toBe(1);
  });
});
