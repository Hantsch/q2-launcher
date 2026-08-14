import type { LauncherBridge } from '@shared/ipc'

/**
 * Access to the preload bridge.
 *
 * Everything the renderer knows about the outside world comes through here. If
 * `window.q2` is missing, the preload script failed to load - that is fatal and
 * worth a loud error rather than a cascade of undefined reads.
 */
function requireBridge(): LauncherBridge {
  const bridge = window.q2
  if (!bridge) {
    throw new Error(
      'The preload bridge is not available. The launcher cannot talk to its main process.',
    )
  }
  return bridge
}

const bridge = requireBridge()

export const invoke: LauncherBridge['invoke'] = (channel, ...args) =>
  bridge.invoke(channel, ...args)

export const onEvent: LauncherBridge['on'] = (channel, listener) => bridge.on(channel, listener)
