import type { EngineKind } from '@shared/types/engine'

/**
 * Story 167: why a demo-playback row cannot be bound on the profile's assigned engines, as an
 * i18n key - or `undefined` when it can.
 *
 * `seek` and the speed `if` chain are Q2PRO verbs; `pause` is stock Quake II and always available.
 * A profile with no assigned engine (empty `engines`) is not judged: nothing says it is r1q2, so
 * the rows stay usable. Never auto-binds anything - this only gates the UI.
 */
export function demoActionUnavailableReason(
  catalogId: string,
  engines: readonly EngineKind[],
): string | undefined {
  if (engines.length === 0 || engines.includes('q2pro')) return undefined
  if (catalogId.startsWith('demo:demoJump')) return 'config.controls.demo.seekNeedsQ2pro'
  if (catalogId.startsWith('demo:demoSpeed')) return 'config.controls.demo.speedNeedsQ2pro'
  return undefined
}
