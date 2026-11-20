const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function fixture({compatFails=true}={}) {
  const handlers = new Map();
  const theme = new EventEmitter();
  theme.shouldUseDarkColorsForSystemIntegratedUI = true;
  let controller, failed = false;
  class Window extends EventEmitter {
    constructor() {
      super(); this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: pathToFileURL(path.join(__dirname, 'renderer/taskbar.html')).href };
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
    }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
    loadFile() { return Promise.resolve(); }
  }
  class Controller extends EventEmitter {
    constructor(factory) { super(); controller = this; this.factory = factory; }
    start() { this.window = this.factory(); }
    stop() { this.window?.destroy(); }
    recreate() { this.window.destroy(); this.window = this.factory(); }
  }
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'taskbar.cjs'), 'utf8'), {
    __dirname, module: exports, setTimeout, clearTimeout,
    require: name => {
      if (name === 'electron') return { BrowserWindow: Window, nativeTheme: theme, Menu: {}, ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) } };
      if (name === 'deskband11lib/electron') return { ElectronTaskbarWindowController: Controller, createTaskbarWindowOptions: value => value };
      if (name === './taskbar-compat.cjs') return { CompatibleTaskbarController: class extends Controller { start(){ if(compatFails)throw Error('Unavailable test shell');super.start();this.emit('attached',{mode:'taskbar'}); } } };
      if (name === 'deskband11lib') return { STRETCH: Number.MAX_VALUE, TaskbarContentPlacement: { BeforeNotificationArea: 2 }, isVerticalTaskbarEdge: () => false };
      return require(name);
    },
  });
  const bar = exports.exports.createTaskbar({ native:true, windows: new Map(), openOffice() {}, openAsk() {}, submit() {}, onFailure: () => { failed = true; } });
  const event = () => ({ sender: controller.window.webContents, senderFrame: controller.window.webContents.mainFrame });
  return { handlers, theme, bar, event, get controller(){return controller;}, failed: () => failed };
}
test('taskbar IPC refuses other windows, subframes and navigated pages', () => {
  const f = fixture();
  const state = f.handlers.get('taskbar:state');
  assert.equal(state(f.event()).draft, '');
  assert.throws(() => state({ sender: {}, senderFrame: {} }), /Not allowed/);
  assert.throws(() => state({ ...f.event(), senderFrame: { ...f.event().senderFrame } }), /Not allowed/);
  f.event().senderFrame.url = 'https://nucleas.app/os/desktop';
  assert.throws(() => state(f.event()), /Not allowed/);
  f.bar.stop();
  assert.equal(f.handlers.size, 0);
  assert.equal(f.theme.listenerCount('updated'), 0);
});
test('taskbar recreation retains draft and rejects the previous renderer', () => {
  const f = fixture();
  const old = f.event();
  f.handlers.get('taskbar:draft')(old, 'Review our companies');
  f.controller.recreate();
  assert.equal(f.handlers.get('taskbar:state')(f.event()).draft, 'Review our companies');
  assert.throws(() => f.handlers.get('taskbar:state')(old), /Not allowed/);
  f.controller.emit('attachFailed');
  assert.equal(f.failed(), true);
  assert.equal(f.bar.active, false);
  assert.equal(f.handlers.size, 0);
  f.bar.stop(); // Idempotent on quit or toggle after failure.
});

test('failed native attachment falls back with the same draft and secure IPC',()=>{
  const f=fixture({compatFails:false}),old=f.event();
  f.handlers.get('taskbar:draft')(old,'Show my office');
  f.controller.emit('attachFailed');
  assert.equal(f.failed(),false);assert.equal(f.bar.attached,true);
  assert.equal(f.handlers.get('taskbar:state')(f.event()).draft,'Show my office');
  assert.throws(()=>f.handlers.get('taskbar:state')(old),/Not allowed/);
  f.bar.stop();assert.equal(f.handlers.size,0);assert.equal(f.theme.listenerCount('updated'),0);
});
