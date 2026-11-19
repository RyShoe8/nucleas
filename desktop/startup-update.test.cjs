const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startupUpdate } = require('./startup-update.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function updater(check) {
  const source = new EventEmitter();
  source.checkForUpdates = () => check(source);
  return source;
}
test('startup waits for a verified download, not merely an available version', async () => {
  const source = updater(s => { s.emit('update-available'); return Promise.resolve(); });
  let finished = false;
  const result = startupUpdate(source).then(value => { finished = true; return value; });
  await Promise.resolve();
  assert.equal(finished, false);
  source.emit('update-downloaded');
  assert.equal(await result, 'ready');
  assert.equal(source.listenerCount('update-downloaded'), 0);
});
test('cached downloads can complete during the initial check', async () => {
  assert.equal(await startupUpdate(updater(s => s.emit('update-downloaded'))), 'ready');
});
test('current release opens normally and removes startup listeners', async () => {
  const source = updater(s => s.emit('update-not-available'));
  assert.equal(await startupUpdate(source), 'current');
  assert.deepEqual(source.eventNames(), []);
});
test('offline, rejected and synchronous update failures do not block opening', async () => {
  for (const check of [s => s.emit('error', new Error('offline')), () => Promise.reject(new Error('offline')), () => { throw Error('offline'); }]) {
    assert.equal(await startupUpdate(updater(check)), 'unavailable');
  }
});
test('a hung service releases startup; late downloads cannot restart through that gate', async () => {
  const source = updater(() => new Promise(() => {}));
  assert.equal(await startupUpdate(source, { checkTimeoutMs: 10 }), 'deferred');
  assert.deepEqual(source.eventNames(), []);
  assert.equal(source.emit('update-downloaded'), false);
});
test('available updates get their own bounded download window', async () => {
  const source = updater(s => s.emit('update-available'));
  const result = startupUpdate(source, { checkTimeoutMs: 1, downloadTimeoutMs: 200 });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(source.listenerCount('update-downloaded'), 1);
  source.emit('update-downloaded');
  assert.equal(await result, 'ready');
  const stalled = updater(s => s.emit('update-available'));
  assert.equal(await startupUpdate(stalled, { downloadTimeoutMs: 10 }), 'deferred');
});

test('packaged startup installs silently and relaunches before opening editable apps', async () => {
  const created = [], installs = [];
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: true, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), setAppUserModelId() {}, getPath: () => 'test', getVersion: () => '0.1.0' });
  class Window extends EventEmitter {
    constructor() { super(); created.push(this); this.webContents = new EventEmitter(); Object.assign(this.webContents, { setWindowOpenHandler() {}, send() {} }); }
    loadFile(file) { this.file = file; return Promise.resolve(); }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    destroy() { this.destroyed = true; }
    isDestroyed() { return !!this.destroyed; }
    setAlwaysOnTop() {}
    getTitle() { return ''; }
    show() {}
    focus() {}
  }
  const source = updater(() => Promise.resolve());
  source.quitAndInstall = (...args) => installs.push(args);
  const profile = { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} };
  const electron = { app, BrowserWindow: Window, ipcMain: { handle() {} }, screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} }, Menu: { buildFromTemplate: v => v }, nativeImage: { createFromPath: () => ({ resize() {} }) }, globalShortcut: { register: () => true }, session: { fromPartition: () => profile } };
  const substitutes = { electron, 'electron-updater': { autoUpdater: source }, 'node:fs': { readFileSync: () => '{}', writeFileSync() {} },
    './renderer/catalog.json': [{ id: 'office', title: 'Office' }], './auth.cjs': {}, './capture.cjs': { installDisplayCapture() {} }, './startup-update.cjs': { startupUpdate } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), {
    require: id => id in substitutes ? substitutes[id] : require(id), __dirname, process: { argv: [] }, URL, setTimeout, clearTimeout, console,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(created.length, 1);
  assert.match(created[0].file, /startup\.html$/);
  source.emit('update-available');
  source.emit('update-downloaded');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(installs, [[true, true]], 'silent install and automatic relaunch');
  assert.equal(created[0].destroyed, true);
  assert.equal(created.some(w => w.url), false, 'no editable workspace before the install');
});
