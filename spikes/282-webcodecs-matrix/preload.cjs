// Sandboxed preload: the only bridge the probe page gets.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  report: (json) => ipcRenderer.send('spike282:report', json),
  write: (position, bytes) => ipcRenderer.invoke('spike282:write', position, bytes),
  finish: () => ipcRenderer.invoke('spike282:finish'),
})
