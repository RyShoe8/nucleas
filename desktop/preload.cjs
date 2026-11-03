const { contextBridge, ipcRenderer } = require('electron');
// No generic IPC, filesystem, shell, credential, or process access is exposed to pages.
const local = location.protocol === 'file:';
if (local || location.origin === 'https://nucleas.app') {
  contextBridge.exposeInMainWorld('nucleasDesktop', Object.freeze({
    openModule: (moduleId, payload) => ipcRenderer.invoke('module:open', { moduleId, payload }),
    ...(local ? {
      state: () => ipcRenderer.invoke('launcher:state'),
      hide: () => ipcRenderer.invoke('launcher:hide'),
      compact: value => ipcRenderer.invoke('launcher:compact', Boolean(value)),
      update: () => ipcRenderer.invoke('update:check'),
      installUpdate: () => ipcRenderer.invoke('update:install'),
      onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('launcher:state', listener); return () => ipcRenderer.removeListener('launcher:state', listener); },
    } : {}),
  }));
}
