import { settingsPatchSchema } from '../lib/schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerSettingsIpc(app: AppContext): void {
  handle('settings:get', () => app.state.settings())

  handle('settings:patch', (patch) => {
    // Throws on a malformed patch: that is a renderer bug, not user input.
    const validated = settingsPatchSchema.parse(patch)
    const next = app.state.patchSettings(validated)
    app.broadcast.emit('settings:changed', next)
    return next
  })
}
