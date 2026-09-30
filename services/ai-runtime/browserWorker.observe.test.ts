import { describe, expect, it } from 'vitest';
import http from 'http';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { observeAuthenticated } from './browserWorker';

const chrome = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
let playwrightAvailable = true;
try { await import(/* @vite-ignore */ 'playwright' as string); } catch { playwrightAvailable = false; }

/** A tiny site: /admin/games needs the session cookie; /admin/delete would change data. */
function site() {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const authed = (req.headers.cookie ?? '').includes('session=ok');
    if (req.url === '/login') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<form method="post" action="/login"><input name="password" type="password"></form>');
      return;
    }
    if (req.url === '/who' ) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<body><script>document.body.textContent = "ua=" + navigator.userAgent + " webdriver=" + navigator.webdriver + " tz=" + Intl.DateTimeFormat().resolvedOptions().timeZone;</script></body>');
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
  const run = async (value: string) => {
    const { server, hits } = site();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const result = await observeAuthenticated(
        { baseUrl: base, url: `${base}/admin/games`, cookies: [{ name: 'session', value, domain: '127.0.0.1', path: '/' }] },
        { allowInsecure: true, executablePath: chrome }
      );
      return { result, hits };
    } finally {
      server.close();
    }
  };

  it('opens the page with the session, reads it, and never sends a write', async () => {
    const { result, hits } = await run('ok');
    expect(result.loggedIn).toBe(true);
    expect(result.text).toContain('OpenRA');
    expect(result.text.match(/OpenHV/g)).toHaveLength(2);
    expect(hits.filter((h) => !h.startsWith('GET'))).toEqual([]);
  }, 60_000);

  it('says so when the session is no longer signed in', async () => {
    const { result } = await run('expired');
    expect(result.loggedIn).toBe(false);
    expect(result.note).toContain('no longer signed in');
    expect(result.text).toBe('');
  }, 60_000);

  it('presents itself as ordinary Chrome, not as headless automation', async () => {
    const { server } = site();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const { text } = await observeAuthenticated({ baseUrl: base, url: `${base}/who`, cookies: [] }, { allowInsecure: true, executablePath: chrome });
      expect(text).toMatch(/ua=Mozilla\/5\.0 \(X11; Linux x86_64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36 /);
      expect(text).not.toContain('Headless');
      expect(text).toContain('webdriver=undefined');
      expect(text).toContain('tz=America/New_York');
    } finally {
      server.close();
    }
  }, 60_000);

  it('drops cookies that belong to other sites and refuses pages outside the site', async () => {
    await expect(observeAuthenticated({ baseUrl: 'https://a.example.com', url: 'https://b.example.com/x', cookies: [] })).rejects.toThrow('outside');
  });
});
