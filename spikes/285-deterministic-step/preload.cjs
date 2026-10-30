// Sandboxed preload for the spike page: a one-way report channel to main, nothing else crosses
// the bridge.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  report: (obj) => ipcRenderer.send('spike:report', obj),
})
