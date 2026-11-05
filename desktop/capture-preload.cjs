const { contextBridge, ipcRenderer } = require('electron');
// Only the local capture picker uses this: list what can be shared, and report the choice.
contextBridge.exposeInMainWorld('capturePicker', Object.freeze({
  sources: () => ipcRenderer.invoke('capture:sources'),
  choose: id => ipcRenderer.invoke('capture:choose', typeof id === 'string' ? id : null),
}));
