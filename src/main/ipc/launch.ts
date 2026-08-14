import { BrowserWindow, app as electronApp } from 'electron'
import { fail } from '@shared/types'
import { launchInputSchema } from '../lib/schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerLaunchIpc(app: AppContext): void {
  handle('launch:plan', async (input) => {
    const parsed = launchInputSchema.safeParse(input)
    if (!parsed.success) return fail('ipc.error.invalidPayload')
    return app.launch.plan(parsed.data)
  })

  handle('launch:start', async (input, event) => {
    const parsed = launchInputSchema.safeParse(input)
    if (!parsed.success) return fail('ipc.error.invalidPayload')

    const result = await app.launch.start(parsed.data)
    if (!result.ok) return result

    const settings = app.state.settings()
    if (settings.closeAfterLaunch) {
      // Quitting means we stop tracking the session, so playtime is not recorded
      // for this launch. That is the documented trade-off of this setting.
      await app.state.settle()
      electronApp.quit()
    } else if (settings.minimizeOnLaunch) {
      BrowserWindow.fromWebContents(event.sender)?.minimize()
    }

    return result
  })

  handle('launch:getState', () => app.launch.getState())
}
