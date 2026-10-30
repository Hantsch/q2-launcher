// Sandboxed preload for the spike page: memory readings and a one-way report channel to main,
// nothing else crosses the bridge. (story 284)

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spike', {
  memory: () => process.getProcessMemoryInfo(),
  report: (obj) => ipcRenderer.send('spike:report', obj),
})
