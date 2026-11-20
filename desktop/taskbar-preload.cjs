const { contextBridge, ipcRenderer } = require('electron');
// This preload is never assigned to an authenticated or remote page.
contextBridge.exposeInMainWorld('nucleasTaskbar', Object.freeze({
  state: () => ipcRenderer.invoke('taskbar:state'),
  office: () => ipcRenderer.invoke('taskbar:office'),
  openAsk: () => ipcRenderer.invoke('taskbar:open-ask'),
  ask: text => ipcRenderer.invoke('taskbar:ask', text),
  saveDraft: text => ipcRenderer.invoke('taskbar:draft', text),
  restore: key => ipcRenderer.invoke('taskbar:restore', key),
  overflow: () => ipcRenderer.invoke('taskbar:overflow'),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('taskbar:state', listener); return () => ipcRenderer.removeListener('taskbar:state', listener); },
}));
