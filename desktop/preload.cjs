const { contextBridge, ipcRenderer } = require('electron');
// No generic IPC, filesystem, shell, credential, or process access is exposed to pages.
const local = location.protocol === 'file:';
if (local || location.origin === 'https://nucleas.app') {
  contextBridge.exposeInMainWorld('nucleasDesktop', Object.freeze({
    showLauncher: () => ipcRenderer.invoke('launcher:show'),
    openModule: (moduleId, payload) => ipcRenderer.invoke('module:open', { moduleId, payload }),
    // An app window can be told to start listening; it cannot start voice in another window itself.
    onVoiceStart: callback => { const listener = () => callback(); ipcRenderer.on('voice:start', listener); return () => ipcRenderer.removeListener('voice:start', listener); },
    ...(local ? {
      signIn: () => ipcRenderer.invoke('auth:signin'),
      startVoice: () => ipcRenderer.invoke('voice:start'),
      onAuthStatus: callback => { const listener = (_event, message) => callback(message); ipcRenderer.on('auth:status', listener); return () => ipcRenderer.removeListener('auth:status', listener); },
      state: () => ipcRenderer.invoke('launcher:state'),
      hide: () => ipcRenderer.invoke('launcher:hide'),
      compact: value => ipcRenderer.invoke('launcher:compact', Boolean(value)),
      update: () => ipcRenderer.invoke('update:check'),
      installUpdate: () => ipcRenderer.invoke('update:install'),
      onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('launcher:state', listener); return () => ipcRenderer.removeListener('launcher:state', listener); },
    } : {}),
  }));
}
