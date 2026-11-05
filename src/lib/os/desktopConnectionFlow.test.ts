import { describe, expect, it, vi } from 'vitest';
import { waitForConnection } from './desktopConnectionFlow';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const FLOW = 'a'.repeat(32);

describe('waiting for a sign-in that happens in the browser', () => {
  it('keeps checking until it finishes, through dropped requests', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ complete: false }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ complete: true, error: false, message: 'deals@example.org connected.' }));
    expect(await waitForConnection(FLOW, { fetcher, pollMs: 1, giveUpMs: 5000 })).toEqual({ error: false, message: 'deals@example.org connected.' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0][0])).toContain(`flow=${FLOW}`);
  });

  it('passes a failed sign-in back as an error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ complete: true, error: true, message: 'Google sign-in was cancelled.' }));
    expect(await waitForConnection(FLOW, { fetcher, pollMs: 1 })).toEqual({ error: true, message: 'Google sign-in was cancelled.' });
  });

  it('gives up rather than polling forever', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ complete: false }));
    expect(await waitForConnection(FLOW, { fetcher, pollMs: 1, giveUpMs: 20 })).toBeNull();
  });
});
