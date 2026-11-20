const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nucleasAttention', Object.freeze({
  state: () => ipcRenderer.invoke('attention:state'), close: () => ipcRenderer.invoke('attention:close'),
  open: id => ipcRenderer.invoke('attention:open', id), interval: minutes => ipcRenderer.invoke('attention:interval', minutes),
  onState: fn => { const listener = (_e, state) => fn(state); ipcRenderer.on('attention:state', listener); return () => ipcRenderer.removeListener('attention:state', listener); },
}));
