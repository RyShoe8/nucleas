const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { ORIGIN } = require('./policy.cjs');
const endpoint = `${ORIGIN}/api/auth/desktop`;
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** A short-lived random-path loopback listener. Session tokens never enter URLs. */
async function callbackListener({ timeoutMs = 600000, stopped = () => false } = {}) {
  const nonce = randomBytes(32).toString('hex');
  let requestId, resolve, reject, timer, finished = false;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  result.catch(() => {});
  const close = () => { clearInterval(timer); server.close(); server.closeAllConnections(); };
  const cancel = () => { if (!finished) { finished = true; reject(Error('Sign-in cancelled. Please try again.')); } close(); };
  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { res.writeHead(400); res.end('Invalid sign-in callback.'); return; }
    if (finished || req.method !== 'GET' || req.headers.host !== `127.0.0.1:${server.address().port}` || url.pathname !== `/nucleas-auth/${nonce}` || url.searchParams.get('request') !== requestId || !validId(url.searchParams.get('code'))) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Invalid sign-in callback.'); return;
    }
    finished = true;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to Nucleas</title><body style="margin:0;background:#13231f;color:#e6f1ec;font:18px system-ui;display:grid;place-items:center;min-height:100vh"><main style="padding:32px;max-width:440px"><h1>Returning to Nucleas.</h1><p>Your app will finish signing in automatically. You can close this tab.</p></main></body></html>');
    res.once('finish', close);
    resolve(url.searchParams.get('code'));
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  server.on('error', cancel);
  const deadline = Date.now() + timeoutMs;
  timer = setInterval(() => { if (stopped() || Date.now() >= deadline) cancel(); }, 250); timer.unref();
  return { port: server.address().port, nonce, bind: id => { if (!validId(id)) throw Error('Invalid sign-in request.'); requestId = id; }, result, cancel };
}

function createAuth(profile, openExternal) {
  let pending, restoring, generation = 0, lastRefresh = 0, signedOut = false, cancelPending;
  async function call(body) {
    const response = await profile.fetch(endpoint, { method: 'POST', credentials: 'include', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!response.ok) { const error = Error(response.status === 401 || response.status === 403 ? 'Please sign in again.' : 'Nucleas could not connect. Please try again.'); error.status = response.status; throw error; }
    return response.json();
  }
  async function clearCookies() {
    await profile.cookies.remove(endpoint, 'nucleas-desktop-refresh');
    await profile.cookies.remove(ORIGIN, 'session');
    await profile.cookies.flushStore();
  }
  async function accept(result, started) {
    if (started !== generation || signedOut) { await clearCookies(); return false; }
    if (typeof result.session !== 'string' || result.session.length > 8192) throw Error('Invalid sign-in response.');
    const expiry = Date.parse(result.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw Error('Invalid session expiry.');
    await profile.cookies.set({ url: ORIGIN, name: 'session', value: result.session, httpOnly: true, secure: true, sameSite: 'lax', path: '/', expirationDate: expiry / 1000 });
    if (started !== generation || signedOut) { await clearCookies(); return false; }
    // Chromium persists the server's HttpOnly refresh Set-Cookie in this same profile.
    await profile.cookies.flushStore(); lastRefresh = Date.now(); return true;
  }
  async function restore(force = false) {
    if (signedOut || pending) return false;
    if (restoring) return restoring;
    const started = generation;
    restoring = (async () => {
      try {
        const cookies = await profile.cookies.get({ url: endpoint });
        const session = cookies.find(c => c.name === 'session');
        if (!cookies.some(c => c.name === 'nucleas-desktop-refresh') && !session) return false;
        if (!force && session?.expirationDate > Date.now() / 1000 + 3600 && Date.now() - lastRefresh < 3600000) return true;
        return await accept(await call({ action: 'refresh' }), started);
      }
      catch (error) {
        if (error.status === 401 || error.status === 403) { signedOut = true; generation++; await clearCookies().catch(() => {}); }
        // Temporary failures preserve saved credentials for the next retry.
        return false;
      }
    })().finally(() => { restoring = undefined; });
    return restoring;
  }
  async function signIn(notify, stopped = () => false, method = 'google') {
    if (pending) return pending;
    if (restoring) await restoring;
    if (pending) return pending;
    signedOut = false; const started = ++generation;
    pending = (async () => {
      const listener = await callbackListener({ stopped }); cancelPending = listener.cancel;
      try {
        const grant = await call({ action: 'start', callbackPort: listener.port, callbackNonce: listener.nonce });
        if (started !== generation || stopped()) throw Error('Sign-in cancelled.');
        if (!validId(grant.requestId) || !validId(grant.proof)) throw Error('Invalid sign-in response.');
        listener.bind(grant.requestId);
        notify('Finish signing in if asked. Nucleas will open automatically.');
        await openExternal(`${endpoint}?request=${grant.requestId}${method === 'email' ? '&method=email' : ''}`);
        const callbackCode = await listener.result;
        if (started !== generation || stopped()) throw Error('Sign-in cancelled.');
        notify('Opening your workspace…');
        const result = await call({ action: 'exchange', requestId: grant.requestId, proof: grant.proof, callbackCode });
        if (!await accept(result, started)) throw Error('Sign-in cancelled.');
      } finally { listener.cancel(); cancelPending = undefined; }
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return { signIn, restore, async forget() { signedOut = true; generation++; cancelPending?.(); await clearCookies(); }, stop() { generation++; cancelPending?.(); } };
}
module.exports = { createAuth, callbackListener };
