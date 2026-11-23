const { shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAuth } = require('./auth-runtime.cjs');
const authFile = path.join(__dirname, 'renderer/auth.html');
const authUrl = pathToFileURL(authFile).href;
const clients = new WeakMap();
function authFor(profile) {
  if (!clients.has(profile)) clients.set(profile, createAuth(profile, url => shell.openExternal(url)));
  return clients.get(profile);
}
const signIn = (profile, notify, stopped = () => false, method = 'google') => authFor(profile).signIn(notify, stopped, method);
module.exports = { signIn, authFor, authFile, authUrl };
