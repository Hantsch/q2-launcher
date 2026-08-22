import { BrowserWindow, app as electronApp } from 'electron'
import { launchGetStateSchema, launchInputSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle, handleOutcome } from './index'

export function registerLaunchIpc(app: AppContext): void {
  handleOutcome('launch:plan', launchInputSchema, async (input) => {
    return app.launch.plan(input)
  })

  handleOutcome('launch:start', launchInputSchema, async (input, event) => {
    const result = await app.launch.start(input)
    if (!result.ok) return result

    const settings = app.state.settings()
    if (settings.closeAfterLaunch) {
      await app.state.settle()
      electronApp.quit()
    } else if (settings.minimizeOnLaunch) {
      BrowserWindow.fromWebContents(event.sender)?.minimize()
    }

    return result
  })

  handle('launch:getState', launchGetStateSchema, () => app.launch.getState())
}
