/** Freeze minimized pages, retaining unsaved UI state without running timers or animation. */
function installWindowLifecycle(win) {
  let timer, disposed = false, ownedDebugger = false, shown = win.isVisible(), chain = Promise.resolve();
  const apply = () => {
    clearTimeout(timer);
    chain = chain.then(async () => {
      if (disposed || win.isDestroyed() || win.webContents.isDestroyed()) return;
      const frozen = win.isMinimized() || !win.isVisible();
      const debug = win.webContents.debugger;
      try {
        if (!debug.isAttached()) { debug.attach('1.3'); ownedDebugger = true; }
        if (ownedDebugger) await debug.sendCommand('Page.setWebLifecycleState', { state: frozen ? 'frozen' : 'active' });
        if (!frozen && ownedDebugger) { ownedDebugger = false; debug.detach(); }
      } catch { /* Chromium also background-throttles; do not break restore if DevTools owns the session. */ }
    });
  };
  const suspend = () => { clearTimeout(timer); timer = setTimeout(apply, 100); };
  win.on('minimize', suspend); win.on('hide', suspend);
  win.on('restore', apply); win.on('show', () => { shown = true; apply(); });
  win.webContents.on('did-finish-load', () => { if (shown || win.isMinimized()) apply(); });
  win.on('closed', () => { disposed = true; clearTimeout(timer); });
}
module.exports = { installWindowLifecycle };
