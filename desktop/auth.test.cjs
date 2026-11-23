const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuth, callbackListener } = require('./auth-runtime.cjs');
const response = body => ({ ok: true, json: async () => body });
function profile() {
  const jar = new Map(), calls = [];
  return { jar, calls, cookies: {
    get: async () => [...jar.values()], set: async cookie => jar.set(cookie.name, cookie), remove: async (_url, name) => jar.delete(name), flushStore: async () => {},
  }, fetch: async (_url, options) => { calls.push(JSON.parse(options.body)); return response({ session: 'synthetic-session', expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() }); } };
}
test('loopback callback rejects wrong state/path and accepts a one-time local code', async () => {
  const listener = await callbackListener(); listener.bind('a'.repeat(64));
  const base = `http://127.0.0.1:${listener.port}/nucleas-auth/${listener.nonce}`;
  try {
    assert.equal((await fetch(`${base}?request=${'b'.repeat(64)}&code=${'c'.repeat(64)}`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${listener.port}/wrong?request=${'a'.repeat(64)}&code=${'c'.repeat(64)}`)).status, 400);
    const callback = await fetch(`${base}?request=${'a'.repeat(64)}&code=${'c'.repeat(64)}`);
    assert.equal(callback.status, 200); assert.match(await callback.text(), /Returning to Nucleas/);
    assert.equal(await listener.result, 'c'.repeat(64));
  } finally { listener.cancel(); }
});
test('sign-in opens the browser once, exchanges the local code, and persists the app session', async () => {
  const p = profile(), requestId = 'a'.repeat(64), proof = 'b'.repeat(64); let destination, grant;
  const originalFetch = p.fetch;
  p.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.action === 'start') { grant = body; p.calls.push(body); return response({ requestId, proof }); }
    assert.equal(body.callbackCode, 'c'.repeat(64)); assert.equal(body.proof, proof);
    // Simulate Chromium's response-cookie handling; this credential never goes to a renderer.
    p.jar.set('nucleas-desktop-refresh', { name: 'nucleas-desktop-refresh', value: 'synthetic-refresh' });
    return originalFetch(url, options);
  };
  const auth = createAuth(p, async url => {
    destination = url;
    const callback = await fetch(`http://127.0.0.1:${grant.callbackPort}/nucleas-auth/${grant.callbackNonce}?request=${requestId}&code=${'c'.repeat(64)}`);
    assert.equal(callback.status, 200);
  });
  await Promise.all([auth.signIn(() => {}), auth.signIn(() => {})]);
  assert.equal(p.calls.filter(c => c.action === 'start').length, 1);
  assert.ok(!destination.includes(proof)); assert.ok(!destination.includes('synthetic-refresh'));
  assert.equal(p.jar.get('session').httpOnly, true); assert.equal(p.jar.get('session').secure, true);
  // New process, same persistent cookie store, no interactive login.
  p.fetch = originalFetch;
  assert.equal(await createAuth(p, () => { throw Error('Must not open browser'); }).restore(), true);
  assert.equal(p.calls.at(-1).action, 'refresh');
});
test('refresh is shared, preserves credentials offline, and cannot undo sign-out', async () => {
  const p = profile(); p.jar.set('nucleas-desktop-refresh', { name: 'nucleas-desktop-refresh', value: 'synthetic' });
  let finish, count = 0;
  p.fetch = () => { count++; return new Promise(resolve => { finish = resolve; }); };
  const auth = createAuth(p, () => {});
  const first = auth.restore(), second = auth.restore();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 1);
  await auth.forget();
  finish(response({ session: 'late', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  assert.equal(await first, false); assert.equal(await second, false); assert.equal(p.jar.size, 0);
  const offline = profile(); offline.jar.set('nucleas-desktop-refresh', { name: 'nucleas-desktop-refresh', value: 'synthetic' });
  offline.fetch = async () => { throw Error('Offline'); };
  assert.equal(await createAuth(offline, () => {}).restore(), false); assert.equal(offline.jar.size, 1);
  offline.fetch = async () => ({ ok: false, status: 401 });
  assert.equal(await createAuth(offline, () => {}).restore(), false); assert.equal(offline.jar.size, 0);
});
test('cancelled browser sign-in closes its listener', async () => {
  const listener = await callbackListener({ stopped: () => true });
  await assert.rejects(listener.result, /cancelled/);
});

test('cancel during setup never opens a browser; cookie-store failure never crashes startup', async () => {
  const p = profile(); let finish;
  p.fetch = () => new Promise(resolve => { finish = resolve; });
  let opened = 0;
  const auth = createAuth(p, () => { opened++; });
  const pending = auth.signIn(() => {});
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const rejected = assert.rejects(pending, /cancelled/);
  auth.stop(); finish(response({ requestId: 'a'.repeat(64), proof: 'b'.repeat(64) }));
  await rejected; assert.equal(opened, 0);
  p.cookies.get = async () => { throw Error('Cookie store unavailable'); };
  assert.equal(await auth.restore(), false);
});

test('sign-out during a cookie write cannot leave a signed-in session behind', async () => {
  const p = profile(); p.jar.set('nucleas-desktop-refresh', { name: 'nucleas-desktop-refresh', value: 'synthetic' });
  let finish;
  p.cookies.set = cookie => new Promise(resolve => { finish = () => { p.jar.set(cookie.name, cookie); resolve(); }; });
  const auth = createAuth(p, () => {}), restoring = auth.restore();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await auth.forget(); finish();
  assert.equal(await restoring, false); assert.equal(p.jar.size, 0);
});
