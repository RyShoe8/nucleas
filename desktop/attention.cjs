const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ORIGIN, moduleRequest } = require('./policy.cjs');
const file = path.join(__dirname, 'renderer/attention.html'), url = pathToFileURL(file).href;
const INTERVALS = [0, 30, 60, 120, 180, 360, 720, 1440];

/** One small authenticated poll per minute for the desktop, independent of all app windows. */
function startAttention({ profile, catalog, openModule, changed }) {
  let current = { items: [], intervalMinutes: 0, error: '', userId: null }, popup, timer, toastTimer, stopped = false, polling = false, generation = 0, controller;
  const safe = event => popup && !popup.isDestroyed() && event.sender === popup.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === url;
  const publish = () => { changed(); if (popup && !popup.isDestroyed()) popup.webContents.send('attention:state', current); };
  const close = () => { clearTimeout(toastTimer); if (popup && !popup.isDestroyed()) popup.destroy(); popup = undefined; };
  function show(passive = false) {
    if (stopped) return;
    clearTimeout(toastTimer);
    if (popup && !popup.isDestroyed()) { if (!passive) { const area=screen.getPrimaryDisplay().workArea;const [width]=popup.getSize(),height=Math.min(520,area.height);popup.setBounds({x:area.x+area.width-width-8,y:area.y+area.height-height-8,width,height});popup.show(); popup.focus(); } publish(); return; }
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(420, area.width), height = Math.min(passive ? 250 : 520, area.height);
    popup = new BrowserWindow({ x: area.x + area.width - width - 8, y: area.y + area.height - height - 8, width, height, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#14242a',
      webPreferences: { preload: path.join(__dirname, 'attention-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const win = popup;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.once('ready-to-show', () => { if (win.isDestroyed()) return; if (passive) { win.showInactive(); toastTimer = setTimeout(close, 9000); } else { win.show(); win.focus(); } });
    win.on('focus', () => { clearTimeout(toastTimer); });
    win.on('blur', close);
    win.on('closed', () => { if (popup === win) popup = undefined; });
    void win.loadFile(file);
  }
  async function refresh() {
    if (stopped || polling) return;
    polling = true;
    const version = generation;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await profile.fetch(`${ORIGIN}/api/os/attention`, { cache: 'no-store', signal: controller.signal, redirect: 'error' });
      if (version !== generation || stopped) return;
      if (response.status === 401 || response.status === 403) { current = { items: [], intervalMinutes: 0, error: 'Sign in to see your review requests.', userId: null }; close(); publish(); return; }
      if (!response.ok) throw new Error('Notifications could not refresh.');
      const data = await response.json();
      if (version !== generation || stopped) return;
      if (!Array.isArray(data.items) || typeof data.userId !== 'string') throw new Error('Notifications could not refresh.');
      const before = new Set(current.userId === data.userId ? current.items.map(i => i.id) : []);
      const items = data.items.filter(i => typeof i.id === 'string' && typeof i.title === 'string' && typeof i.companyName === 'string' && moduleRequest({ moduleId: i.moduleId, payload: i.payload }, catalog));
      current = { items, intervalMinutes: INTERVALS.includes(data.intervalMinutes) ? data.intervalMinutes : 0, error: '', userId: data.userId };
      publish();
      if (items.some(i => !before.has(i.id))) show(true);
    } catch { if (!stopped && version === generation) { current = { ...current, error: 'Offline · showing the last review requests. Reconnect to refresh.' }; publish(); } }
    finally { clearTimeout(timeout); polling = false; if (!stopped) { clearTimeout(timer); timer = setTimeout(refresh, version === generation ? 60_000 : 1500); } }
  }
  const handlers = {
    'attention:state': () => current,
    'attention:close': close,
    'attention:open': id => { const item = current.items.find(i => i.id === id); if (!item) throw Error('This request is no longer waiting.'); openModule({ moduleId: item.moduleId, payload: item.payload }); close(); },
    'attention:interval': async minutes => {
      if (!INTERVALS.includes(minutes)) throw Error('Choose an available interval.');
      const version = generation;
      const response = await profile.fetch(`${ORIGIN}/api/os/attention`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intervalMinutes: minutes }), signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok || version !== generation) throw Error('Could not save email settings.');
      current = { ...current, intervalMinutes: minutes }; publish();
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, (event, value) => { if (!safe(event)) throw Error('Not allowed'); return handler(value); });
  const cookieChanged = (_event, cookie) => {
    if (cookie.name !== 'session' || !['nucleas.app', '.nucleas.app'].includes(cookie.domain)) return;
    generation++; controller?.abort(); current = { items: [], intervalMinutes: 0, error: '', userId: null }; close(); publish();
    clearTimeout(timer); timer = setTimeout(refresh, 1500);
  };
  profile.cookies.on('changed', cookieChanged);
  void refresh();
  return { show, snapshot: () => ({ count: current.items.length, error: current.error }), stop() { stopped = true; generation++; controller?.abort(); clearTimeout(timer); close(); profile.cookies.removeListener('changed', cookieChanged); for (const key of Object.keys(handlers)) ipcMain.removeHandler(key); } };
}
module.exports = { startAttention, INTERVALS };
