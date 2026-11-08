const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioBackup', Object.freeze({
  create: (language) => ipcRenderer.invoke('backup:create', language),
  restore: (language) => ipcRenderer.invoke('backup:restore', language),
}));
