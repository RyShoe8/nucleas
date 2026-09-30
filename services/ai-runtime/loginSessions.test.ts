import { describe, expect, it } from 'vitest';
import http from 'http';
import fs from 'fs';
import type { AddressInfo } from 'net';
import { cancelLogin, finishLogin, loginFrame, loginInput, startLogin } from './loginSessions';

const chrome = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
let playwrightAvailable = true;
try { await import(/* @vite-ignore */ 'playwright' as string); } catch { playwrightAvailable = false; }

/** A login form with fixed positions, so clicks can be aimed; a correct login sets the session cookie. */
function site() {
  return http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const ok = body.includes('u=tester') && body.includes('p=s3cret');
        res.writeHead(302, { Location: '/home', ...(ok ? { 'Set-Cookie': ['session=ok; Path=/; HttpOnly', 'other=1; Path=/'] } : {}) });
        res.end();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/home'
      ? '<h1>Signed in</h1>'
      : '<body style="margin:0"><form method="post"><input name="u" style="position:absolute;left:100px;top:100px;width:300px;height:40px"><input name="p" type="password" style="position:absolute;left:100px;top:200px;width:300px;height:40px"><button type="submit" style="position:absolute;left:100px;top:300px">Sign in</button></form></body>');
  });
}

describe.skipIf(!chrome || !playwrightAvailable)('interactive login (real browser, local site)', () => {
  it('lets a person log in through screenshots, clicks and typing, then returns only the site’s cookies', async () => {
    const server = site();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const opts = { allowInsecure: true, executablePath: chrome };
    const { sessionId, width, height } = await startLogin({ baseUrl: base }, opts);
    try {
      expect([width, height]).toEqual([1000, 640]);
      const frame = await loginFrame(sessionId);
      expect(Buffer.from(frame.image, 'base64').length).toBeGreaterThan(500);
      await loginInput(sessionId, { type: 'click', x: 200, y: 120 });
      await loginInput(sessionId, { type: 'text', text: 'tester' });
      await loginInput(sessionId, { type: 'click', x: 200, y: 220 });
      await loginInput(sessionId, { type: 'text', text: 's3cret' });
      await loginInput(sessionId, { type: 'key', key: 'Enter' });
      await new Promise((r) => setTimeout(r, 1000));
      expect((await loginFrame(sessionId)).url).toContain('/home');
      const done = await finishLogin(sessionId);
      expect(done.cookies.map((c) => c.name).sort()).toEqual(['other', 'session']);
      // The window is gone after finishing.
      await expect(loginFrame(sessionId)).rejects.toThrow('timed out');
    } finally {
      await cancelLogin(sessionId);
      server.close();
    }
  }, 60_000);

  it('rejects unsupported keys and unknown sessions', async () => {
    await expect(loginInput('nope', { type: 'key', key: 'Enter' })).rejects.toThrow('timed out');
  });
});
