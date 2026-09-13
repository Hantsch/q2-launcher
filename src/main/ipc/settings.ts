import { settingsGetSchema, settingsPatchSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerSettingsIpc(app: AppContext): void {
  handle('settings:get', settingsGetSchema, () => app.state.settings())

  // The wrapper throws on a malformed patch: that is a renderer bug, not user
  // input, and this channel has no failure case in its response type.
  handle('settings:patch', settingsPatchSchema, (patch) => {
    const next = app.state.patchSettings(patch)
    app.broadcast.emit('settings:changed', next)
    return next
  })
}
