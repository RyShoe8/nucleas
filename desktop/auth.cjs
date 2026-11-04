const { shell } = require('electron');
const { ORIGIN } = require('./policy.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const authFile = path.join(__dirname, 'renderer/auth.html');
const authUrl = pathToFileURL(authFile).href;
let pending;
async function signIn(profile, notify, stopped = () => false) {
  if (pending) return pending;
  pending = (async () => {
    async function call(body) {
      const response = await profile.fetch(`${ORIGIN}/api/auth/desktop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Sign-in could not connect. Please try again.');
      return response.json();
    }
    const grant = await call({ action: 'start' });
    if (!/^[a-f0-9]{64}$/.test(grant.requestId) || !/^[a-f0-9]{64}$/.test(grant.proof) || !/^[A-F0-9]{8}$/.test(grant.code)) throw new Error('Invalid sign-in response.');
    notify(`Match this code in your browser: ${grant.code}. Sign in and choose Connect this desktop.`);
    await shell.openExternal(`${ORIGIN}/api/auth/desktop?request=${grant.requestId}`);
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline && !stopped()) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const result = await call({ action: 'exchange', requestId: grant.requestId, proof: grant.proof });
      if (typeof result.session === 'string') {
        await profile.cookies.set({ url: ORIGIN, name: 'session', value: result.session, httpOnly: true, secure: true, sameSite: 'lax', path: '/', expirationDate: Date.now() / 1000 + 7 * 86400 });
        await profile.cookies.flushStore();
        return;
      }
    }
    throw new Error('Sign-in expired or was cancelled. Please try again.');
  })().finally(() => { pending = undefined; });
  return pending;
}
module.exports = { signIn, authFile, authUrl };
