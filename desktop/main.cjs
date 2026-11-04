const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, shell, dialog, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ORIGIN, trustedRemote, externalUrl, moduleRequest, visibleBounds } = require('./policy.cjs');
const catalog = require('./renderer/catalog.json');
const { signIn, authFile, authUrl } = require('./auth.cjs');
const targets = new Map();
const launcherFile = path.join(__dirname, 'renderer/index.html');
const launcherUrl = pathToFileURL(launcherFile).href;
let launcher, tray, quitting = false, compact = false;
let update = { phase: 'idle', text: 'Checking for updates…' };
const windows = new Map();
let saved = {};
const settingsPath = () => path.join(app.getPath('userData'), 'windows.json');
const bounds = value => visibleBounds(value, screen.getAllDisplays().map(d => d.workArea));
let persistTimer;
function persist() { clearTimeout(persistTimer); persistTimer = setTimeout(flushBounds, 350); }
function flushBounds() { clearTimeout(persistTimer); persistTimer = undefined; try { fs.writeFileSync(settingsPath(), JSON.stringify(saved)); } catch { /* Read-only profiles still run. */ } }
function state() { return { version: app.getVersion(), update, compact, apps: catalog.filter(m => !m.hidden), windows: [...windows].map(([key, w]) => ({ key, title: w.getTitle() })) }; }
function broadcast() { if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:state', state()); }
function status(phase, text) { if (update.phase === phase && update.text === text) return; update = { phase, text }; broadcast(); }
function localSender(event) { return event.sender === launcher?.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === launcherUrl; }
function moduleSender(event) { return localSender(event) || ([...windows.values()].some(w => w.webContents === event.sender) && event.senderFrame === event.sender.mainFrame && trustedRemote(event.senderFrame.url)); }
function secureWindow(win, local = false) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (externalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!local && trustedRemote(url) && new URL(url).pathname === '/login') { event.preventDefault(); void win.loadFile(authFile); return; }
    if (local || !trustedRemote(url)) { event.preventDefault(); if (!local && externalUrl(url)) void shell.openExternal(url); }
  });
  win.webContents.on('will-redirect', (event, url, _inPlace, mainFrame) => {
    if (!mainFrame) return;
    if (!local && trustedRemote(url) && new URL(url).pathname === '/login') { event.preventDefault(); void win.loadFile(authFile); return; }
    if (!local && !trustedRemote(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
}
let probeStarted = false;
function createLauncher() {
    launcher = new BrowserWindow({ ...bounds(saved.launcher), width: 440, height: compact ? 92 : 600, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    secureWindow(launcher, true);
    const current = launcher;
    let releaseTimer;
    current.on('hide', () => {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        if (!current.isDestroyed() && !current.isVisible()) current.destroy();
      }, 2500);
    });
    current.on('show', () => { clearTimeout(releaseTimer); broadcast(); });
    current.on('closed', () => {
      clearTimeout(releaseTimer);
      if (launcher === current) launcher = null;
    });
    launcher.on('close', event => { if (!quitting) { event.preventDefault(); launcher.hide(); } });
    launcher.on('moved', () => { saved.launcher = launcher.getBounds(); persist(); });
    launcher.once('ready-to-show', async () => {
      if (!app.isPackaged && !probeStarted && process.argv.includes('--resource-test')) {
        probeStarted = true;
        await require('./resource-probe.cjs')(app, launcher, process.argv.includes('--baseline') ? 'baseline' : 'optimized');
        showLauncher();
        await new Promise(resolve => { if (launcher.webContents.isLoading()) launcher.webContents.once('did-finish-load', resolve); else resolve(); });
        if (!(await launcher.webContents.executeJavaScript('Boolean(document.getElementById("ask"))'))) throw new Error('Launcher did not restore');
        quitting = true; app.quit();
      } else if (!app.isPackaged && process.argv.includes('--smoke-test')) {
        await new Promise(resolve => setTimeout(resolve, 700));
        const count = await launcher.webContents.executeJavaScript('document.querySelectorAll(".app").length');
        if (count !== catalog.filter(entry => !entry.hidden && entry.id !== 'assistant').length) throw new Error('Launcher failed to render catalog');
        const capture = await launcher.webContents.capturePage();
        fs.mkdirSync(path.join(__dirname, 'release'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'release/launcher-preview.png'), capture.toPNG());
        openModule({ moduleId: 'work' });
        openModule({ moduleId: 'growth' });
        openModule({ moduleId: 'work' });
        if (windows.size !== 2) throw new Error('Native windows failed to deduplicate');
        fs.writeFileSync(path.join(__dirname, 'release/smoke-test.json'), JSON.stringify({ apps: count, nativeWindows: windows.size, duplicateFocused: true }));
        quitting = true; app.quit();
      } else showLauncher();
    });
    void launcher.loadFile(launcherFile);
}
function showLauncher() { if (!launcher) { createLauncher(); return; } launcher.show(); launcher.focus(); }
function openModule(raw) {
  const value = moduleRequest(raw, catalog);
  if (!value) throw new Error('Unknown app or invalid context.');
  const existing = windows.get(value.key);
  if (existing) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); return; }
  if (windows.size >= 30) throw new Error('Close an app window before opening another.');
  const definition = catalog.find(m => m.id === value.moduleId);
  const target = new URL('/os/desktop', ORIGIN);
  target.searchParams.set('module', value.moduleId);
  target.searchParams.set('payload', JSON.stringify(value.payload));
  const win = new BrowserWindow({ ...bounds(saved[value.key] || { width: value.moduleId === 'assistant' ? 720 : 1120, height: 780 }), minWidth: 400, minHeight: 300, show: false,
    title: definition.title, backgroundColor: '#0e121c', autoHideMenuBar: true, backgroundMaterial: 'mica',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#141822', symbolColor: '#c6cedf', height: 47 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:nucleas', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  windows.set(value.key, win);
  targets.set(win, target.href);
  secureWindow(win);
  win.once('ready-to-show', () => win.show());
  win.on('close', () => { saved[value.key] = win.getNormalBounds(); persist(); });
  win.on('closed', () => { windows.delete(value.key); targets.delete(win); broadcast(); });

  // Login uses the ordinary shared cookie session; return to this app after login.
  win.webContents.on('did-navigate', (_event, url) => {
    if (trustedRemote(url) && new URL(url).pathname === '/login') { void win.loadFile(authFile); return; }
    if (trustedRemote(url) && ['/', '/os'].includes(new URL(url).pathname)) void win.loadURL(target.href);
  });
  win.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) status('error', 'An app could not connect. Check your connection and reopen it.');
  });
  void win.loadURL(target.href);
  broadcast();
}
async function checkUpdates() {
  if (!app.isPackaged) { status('development', 'Development build · updates begin with an installed release'); return; }
  if (update.phase === 'ready') { if (windows.size === 0) installUpdate(); return; }
  if (['checking', 'downloading'].includes(update.phase)) return;
  status('checking', 'Checking for updates…');
  try { await autoUpdater.checkForUpdates(); } catch { status('error', 'Update service unavailable · try again'); }
}
function installUpdate() { if (update.phase === 'ready') { quitting = true; autoUpdater.quitAndInstall(false, true); } }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { showLauncher(); void checkUpdates(); });
  app.whenReady().then(() => {
    app.setAppUserModelId('app.nucleas.desktop');
    try { const value = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { saved = {}; }
    const profile = session.fromPartition('persist:nucleas');
    profile.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => trustedRemote(requestingOrigin) && ['media', 'notifications', 'clipboard-sanitized-write'].includes(permission));
    profile.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
      if (!trustedRemote(webContents.getURL()) || !trustedRemote(details.requestingUrl) || !['media', 'notifications', 'clipboard-sanitized-write'].includes(permission)) return callback(false);
      const choice = await dialog.showMessageBox(BrowserWindow.fromWebContents(webContents), { type: 'question', buttons: ['Not now', 'Allow'], defaultId: 0, cancelId: 0, message: `Allow Nucleas to use ${permission === 'media' ? 'your microphone or camera' : permission}?` });
      callback(choice.response === 1);
    });
    createLauncher();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'renderer/icon.png')).resize({ width: 20, height: 20 }));
    tray.setToolTip('Nucleas · Alt+Space');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Nucleas', click: showLauncher }, { label: 'Ask Nucleas', click: () => openModule({ moduleId: 'assistant' }) },
      { type: 'separator' }, { label: 'Check for updates', click: checkUpdates },
      { label: 'Quit Nucleas', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showLauncher);
    if (!globalShortcut.register('Alt+Space', () => launcher?.isVisible() ? launcher.hide() : showLauncher())) status('notice', 'Alt+Space is in use · open Nucleas from the tray');
    ipcMain.handle('module:open', (event, value) => { if (!moduleSender(event)) throw new Error('Not allowed'); return openModule(value); });
    ipcMain.handle('auth:signin', async event => {
      const win = [...windows.values()].find(w => w.webContents === event.sender);
      if (!win || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== authUrl) throw new Error('Not allowed');
      await signIn(profile, message => {
        for (const w of windows.values()) if (!w.isDestroyed() && w.webContents.getURL() === authUrl) w.webContents.send('auth:status', message);
      }, () => quitting || windows.size === 0);
      for (const [w, target] of targets) if (!w.isDestroyed() && w.webContents.getURL() === authUrl) void w.loadURL(target);
    });
    for (const [channel, handler] of Object.entries({
      'launcher:state': state, 'launcher:hide': () => launcher.hide(),
      'launcher:compact': value => { compact = Boolean(value); launcher.setSize(440, compact ? 92 : 600); launcher.setBounds(bounds(launcher.getBounds())); broadcast(); },
      'update:check': checkUpdates, 'update:install': installUpdate,
    })) ipcMain.handle(channel, (event, value) => { if (!localSender(event)) throw new Error('Not allowed'); return handler(value); });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', () => status('downloading', 'Downloading the latest Nucleas…'));
    autoUpdater.on('download-progress', progress => status('downloading', `Updating · ${Math.round(progress.percent)}%`));
    autoUpdater.on('update-not-available', () => status('current', 'You’re up to date'));
    autoUpdater.on('error', () => status('error', 'Update service unavailable · try again'));
    autoUpdater.on('update-downloaded', () => { status('ready', 'Update ready · restart to install'); if (windows.size === 0) installUpdate(); });
    void checkUpdates();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { if (persistTimer) flushBounds(); globalShortcut.unregisterAll(); });
  app.on('window-all-closed', () => {});
}
