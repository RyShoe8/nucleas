const { BrowserWindow, ipcMain, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { minimizedWindows, restoreWindow, MAX_QUESTION_LENGTH } = require('./taskbar-state.cjs');
const file = path.join(__dirname, 'renderer/taskbar.html');
const url = pathToFileURL(file).href;

/** Owns only the local taskbar surface. No provider credentials, web content or general-purpose IPC. */
function createTaskbar({ windows, openOffice, openAsk, submit, onFailure, onStatus=()=>{}, native=true, attention = () => ({ count: 0 }), openAttention = () => {} }) {
  let controller, draft = '', attached = false, vertical = false, stopping = false, compatibility=!native, attachTimer;
  const snapshot = () => ({ windows: minimizedWindows(windows), draft, vertical, attention: attention(), dark: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI });
  const senderAllowed = event => {
    const win = controller?.window;
    return Boolean(win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === url);
  };
  const broadcast = () => {
    const win = controller?.window;
    if (win && !win.isDestroyed()) win.webContents.send('taskbar:state', snapshot());
  };
  const channels = {
    'taskbar:state': snapshot,
    'taskbar:office': openOffice,
    'taskbar:open-ask': openAsk,
    'taskbar:attention': openAttention,
    'taskbar:ask': text => { submit(text); draft = ''; },
    'taskbar:draft': value => { if (typeof value === 'string' && value.length <= MAX_QUESTION_LENGTH) draft = value; },
    'taskbar:restore': key => { if (!restoreWindow(windows, key)) throw new Error('This window has closed. Open it from Office.'); },
    'taskbar:overflow': () => {
      const entries = minimizedWindows(windows);
      if (entries.length) Menu.buildFromTemplate(entries.map(entry => ({ label: entry.title, click: () => restoreWindow(windows, entry.key) }))).popup({ window: controller.window });
    },
  };
  for (const [channel, action] of Object.entries(channels)) ipcMain.handle(channel, (event, value) => {
    if (!senderAllowed(event)) throw new Error('Not allowed');
    return action(value);
  });
  nativeTheme.on('updated', broadcast);
  function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(attachTimer);
    nativeTheme.removeListener('updated', broadcast);
    for (const channel of Object.keys(channels)) ipcMain.removeHandler(channel);
    const win = controller?.window;
    try { controller?.stop(); }
    catch { if (win && !win.isDestroyed()) win.destroy(); }
    finally { controller = undefined; }
  }
  function fail(error) {
    if (stopping) return;
    clearTimeout(attachTimer);
    const reason=String(error?.errorMessage??error?.message??'Windows could not attach the taskbar toolbar.').slice(0,250);
    if(!compatibility){compatibility=true;controller?.stop();onStatus({mode:'connecting',detail:'Trying compatible taskbar mode…'});start();return;}
    stop(); onFailure(reason);
  }
  function start(){try {
    const { ElectronTaskbarWindowController, createTaskbarWindowOptions } = require('deskband11lib/electron');
    const { STRETCH, TaskbarContentPlacement, isVerticalTaskbarEdge } = require('deskband11lib');
    const Controller=compatibility?require('./taskbar-compat.cjs').CompatibleTaskbarController:ElectronTaskbarWindowController;
    controller = new Controller(() => {
      attached = false;
      const win = new BrowserWindow(createTaskbarWindowOptions({
        width: 600, height: 48, transparent: true, backgroundColor: '#00000000', title: 'Nucleas taskbar',
        webPreferences: { preload: path.join(__dirname, 'taskbar-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: true },
      }));
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('will-attach-webview', event => event.preventDefault());
      win.webContents.on('render-process-gone', fail);
      win.webContents.on('did-finish-load', broadcast);
      void win.loadFile(file).catch(fail);
      return win;
    }, {
      preferredWidth: STRETCH, preferredHeight: 48, placement: TaskbarContentPlacement.BeforeNotificationArea,
      trackTaskbarButtons: true, trackNotificationArea: true,
      animateLayoutChanges: false, highRefreshRateMode: false,
      layoutRefreshInterval: 500, eventPollInterval: 250,
    });
    controller.on('attached', event => { clearTimeout(attachTimer);attached = true;onStatus({mode:event?.mode??'taskbar',detail:event?.mode==='edge'?'Quick bar beside the taskbar — no safe space inside it.':'Nucleas is in your taskbar.'});broadcast(); });
    controller.on('taskbarEdgeChanged', event => { vertical = event.taskbarEdge==='vertical'||(typeof event.taskbarEdge!=='string'&&isVerticalTaskbarEdge(event.taskbarEdge)); broadcast(); });
    controller.on('attachFailed', fail);
    controller.on('layoutError', fail);
    controller.start();
    if(!compatibility)attachTimer=setTimeout(()=>{if(!attached)fail();},12000);
  } catch(error) { fail(error); }}
  start();
  return { stop, broadcast, get active() { return !stopping; }, get attached() { return attached && !stopping; } };
}
module.exports = { createTaskbar };
