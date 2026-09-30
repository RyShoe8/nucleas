import { describe, expect, it } from 'vitest';
import http from 'http';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { observeAuthenticated } from './browserWorker';

const chrome = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
let playwrightAvailable = true;
try { await import(/* @vite-ignore */ 'playwright' as string); } catch { playwrightAvailable = false; }

/** A tiny site: /admin/games needs the cookie; /login accepts one account; /admin/delete would change data. */
function site() {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const authed = (req.headers.cookie ?? '').includes('session=ok');
    if (req.url === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const ok = body.includes('username=tester') && body.includes('password=s3cret');
        res.writeHead(302, { Location: ok ? '/admin/games' : '/login', ...(ok ? { 'Set-Cookie': 'session=ok; Path=/' } : {}) });
        res.end();
      });
      return;
    }
    if (req.url === '/login') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<form method="post" action="/login"><input name="username" type="text"><input name="password" type="password"><button type="submit">Sign in</button></form>');
      return;
    }
    if (req.url === '/admin/games' && authed) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Game servers</h1><h2>OpenRA</h2><ul><li>Editions</li><li>OpenHV</li></ul><h2>Standalone</h2><ul><li>OpenHV</li></ul><script>fetch("/admin/delete",{method:"POST"});</script>');
      return;
    }
    if (req.url === '/admin/games') { res.writeHead(302, { Location: '/login' }); res.end(); return; }
    res.writeHead(200); res.end('other');
  });
  return { server, hits };
}

describe.skipIf(!chrome || !playwrightAvailable)('observeAuthenticated (real browser, local site)', () => {
  const run = async (password: string) => {
    const { server, hits } = site();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const result = await observeAuthenticated({ baseUrl: base, url: `${base}/admin/games`, username: 'tester', password }, { allowInsecure: true, executablePath: chrome });
      return { result, hits };
    } finally {
      server.close();
    }
  };

  it('logs in, reads the page, and never sends a write after login', async () => {
    const { result, hits } = await run('s3cret');
    expect(result.loggedIn).toBe(true);
    expect(result.text).toContain('OpenRA');
    expect(result.text.match(/OpenHV/g)).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('s3cret');
    expect(hits.filter((h) => h.startsWith('POST') && !h.includes('/login'))).toEqual([]);
  }, 60_000);

  it('says so when the account is not accepted', async () => {
    const { result } = await run('wrong');
    expect(result.loggedIn).toBe(false);
    expect(result.note).toContain('not accepted');
  }, 60_000);

  it('refuses pages outside the account’s site', async () => {
    await expect(observeAuthenticated({ baseUrl: 'https://a.example.com', url: 'https://b.example.com/x', username: 'u', password: 'p' })).rejects.toThrow('outside');
  });
});
