const { contextBridge, ipcRenderer } = require('electron');
// Only the local workspace receives this preload; social pages receive no bridge.
contextBridge.exposeInMainWorld('socialDesktop', Object.freeze({
  command: (name, payload) => ipcRenderer.invoke('social-desk:command', name, payload),
  onEvent: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('social-desk:event', listener);
    return () => ipcRenderer.removeListener('social-desk:event', listener);
  }
}));
