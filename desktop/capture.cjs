const { BrowserWindow, desktopCapturer, ipcMain, webContents: allContents } = require('electron');
const path = require('node:path');
const { trustedRemote } = require('./policy.cjs');

/**
 * Screen capture for app windows. Electron has no built-in picker on Windows: without this handler every
 * getDisplayMedia call fails, which breaks the Screenshot and Screen recorder tools. Only Nucleas pages can ask,
 * and the person always chooses what to share.
 */

const pickerFile = path.join(__dirname, 'renderer/capture-picker.html');
const THUMBNAIL = { width: 320, height: 180 };
let open = null;

/** Lists screens and windows and asks the person. Resolves to the chosen source, or null if they cancel. */
async function pickSource(parent) {
  if (open) { open.focus(); return null; }
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL });
  const views = sources.map(source => ({ id: source.id, name: source.name, screen: source.id.startsWith('screen:'), thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL() }));
  return new Promise(resolve => {
    const win = new BrowserWindow({ width: 760, height: 560, minWidth: 460, minHeight: 360, parent: parent || undefined, modal: Boolean(parent), title: 'Choose what to share', autoHideMenuBar: true, backgroundColor: '#141822', show: false,
      webPreferences: { preload: path.join(__dirname, 'capture-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    open = win;
    let chosen = null;
    const fromPicker = event => event.sender === win.webContents && event.senderFrame === event.sender.mainFrame;
    const onList = event => { if (!fromPicker(event)) throw new Error('Not allowed'); return views; };
    const onChoose = (event, id) => {
      if (!fromPicker(event)) throw new Error('Not allowed');
      chosen = sources.find(source => source.id === id) ?? null;
      win.close();
    };
    ipcMain.handle('capture:sources', onList);
    ipcMain.handle('capture:choose', onChoose);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      ipcMain.removeHandler('capture:sources');
      ipcMain.removeHandler('capture:choose');
      open = null;
      resolve(chosen);
    });
    void win.loadFile(pickerFile);
  });
}

function parentOf(request) {
  try {
    const contents = request.frame && allContents.fromFrame(request.frame);
    return contents ? BrowserWindow.fromWebContents(contents) : BrowserWindow.getFocusedWindow();
  } catch { return BrowserWindow.getFocusedWindow(); }
}

/** choose is replaceable for tests. */
function installDisplayCapture(profile, choose = pickSource) {
  profile.setDisplayMediaRequestHandler((request, callback) => {
    const deny = () => { try { callback(null); } catch { /* The request has already ended. */ } };
    if (!trustedRemote(request.securityOrigin)) return deny();
    void Promise.resolve(choose(parentOf(request))).then(source => {
      if (!source) return deny();
      // Loopback is Windows system audio; the recorder's "system audio" option asks for it.
      callback(request.audioRequested ? { video: source, audio: 'loopback' } : { video: source });
    }, deny);
  }, { useSystemPicker: false });
}

module.exports = { installDisplayCapture, pickSource };
