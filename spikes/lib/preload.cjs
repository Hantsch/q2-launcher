// Sandboxed preload shared by the engine spikes: a one-way report channel to main and a memory
// reading, nothing else crosses the bridge.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  report: (obj) => ipcRenderer.send('spike:report', obj),
  memory: () => process.getProcessMemoryInfo(),
})
