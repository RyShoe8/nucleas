import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
vi.mock('node:https', () => ({ request: vi.fn() }));
import { request } from 'node:https';
import { connectorTransport } from '../transport';
import { websiteConnectorConfigSchema } from '../contracts';

describe('production pinned HTTPS transport without network calls', () => {
  it.each([200, 302])('pins DNS and preserves SNI; HTTP %s', async statusCode => {
    const response = Object.assign(new EventEmitter(), { statusCode, resume: vi.fn(), destroy: vi.fn() });
    const req = Object.assign(new EventEmitter(), { end: vi.fn(() => {
      queueMicrotask(() => {
        const callback = vi.mocked(request).mock.calls.at(-1)![2] as (response: unknown) => void;
        callback(response);
        if (statusCode === 200) { response.emit('data', Buffer.from('{"ok":true}')); response.emit('end'); }
        req.emit('close');
      });
    }), destroy: vi.fn() });
    vi.mocked(request).mockReturnValueOnce(req as unknown as ReturnType<typeof request>);
    const config = websiteConnectorConfigSchema.parse({ version: 1, adapter: 'website-v1', origin: 'https://one.com', permissions: [], collection: 'posts' });
    const result = connectorTransport(config, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], now: () => 1000 })('GET', { op: 'content.items.list' }, 'secret');
    if (statusCode === 200) await expect(result).resolves.toEqual({ ok: true });
    else await expect(result).rejects.toThrow('302');
    const options = vi.mocked(request).mock.calls.at(-1)![1] as import('node:https').RequestOptions;
    expect(options.servername).toBe('one.com');
    const done = vi.fn();
    (options.lookup as (host: string, options: object, callback: typeof done) => void)('one.com', {}, done);
    expect(done).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(options.headers).toMatchObject({ 'x-nucleas-timestamp': '1' });
  });
});
