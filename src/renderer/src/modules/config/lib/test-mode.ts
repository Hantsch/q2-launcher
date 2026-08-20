/**
 * Test-mode press resolution and layer-switch reducer — story 018 D1.
 *
 * Test mode answers "what happens when I press this key". Before this module
 * existed, the readout only ever looked at `profile.binds`, so a layer's
 * trigger key — which lives on `AltLayer.triggerKey` and is emitted by
 * `generateLayerAliases` (`alt-layers.ts`) — was invisible to it and reported
 * as unbound, even though it is exactly what activates the layer. This module
 * is the pure resolver plus the equally pure state transition that puts the
 * activated layer on the board, so both are testable under `npm test`
 * (`environment: 'node'`, `.tsx` files are excluded) without dragging any of
 * it into `OverviewKeyboardPanel.tsx`.
 *
 * Pure by contract, like `trigger-keys.ts`: no React, no DOM, no electron.
 */

import type { AltLayer, AltLayerMode } from '@shared/config/alt-layers'
import { generateLayerAliases } from '@shared/config/alt-layers'
import type { ConfigAction } from '@shared/modules/config'
import { triggerSelectTarget } from './trigger-keys'

/** The subset of a profile a press needs to resolve against. */
export interface TestModeProfile {
  binds: Record<string, string>
  layers: readonly AltLayer[]
  actions: readonly ConfigAction[]
}

/**
 * What pressing `key` means, resolved in the order decision 2 fixes: trigger
 * (of any layer, regardless of what is currently displayed) → the displayed
 * layer's own override → the base bind → unbound.
 */
export type TestPress = { key: string } & (
  | { kind: 'trigger'; layerId: string; layerName: string; mode: AltLayerMode; alias: string | null }
  | { kind: 'override' | 'base'; command: string; layerName?: string }
  | { kind: 'unbound' }
)

/**
 * Resolve what pressing `key` means. A layer's trigger key outranks
 * everything else — it is what puts the layer on the board in the first
 * place, exactly the precedence 014 D3 already established for the keycap's
 * own appearance — so every layer's `triggerKey` is checked before the
 * displayed layer's overrides or the base binds.
 *
 * The fired alias is read from `generateLayerAliases(layer, binds).triggerBind`,
 * never re-derived: that function is the one thing that actually writes the
 * config, so anything else would be a second, drift-prone implementation of
 * the same rule (decision 3). If `triggerBind` is `null` (e.g. a
 * `layer.selfbind` issue), the press still resolves as `kind: 'trigger'` with
 * `alias: null` — reporting "unbound" for a key that is demonstrably a
 * trigger is the exact bug this story fixes (decision 4).
 */
export function resolveTestPress(
  key: string,
  profile: TestModeProfile,
  displayedLayerId: string | null,
): TestPress {
  const target = key.trim().toLowerCase()

  const triggerLayer = profile.layers.find((candidate) => {
    const trigger = candidate.triggerKey?.trim().toLowerCase() ?? ''
    return trigger.length > 0 && trigger === target
  })

  if (triggerLayer) {
    const { triggerBind } = generateLayerAliases(triggerLayer, profile.binds)
    return {
      key,
      kind: 'trigger',
      layerId: triggerLayer.id,
      layerName: triggerLayer.name,
      mode: triggerLayer.mode,
      alias: triggerBind?.command ?? null,
    }
  }

  const displayedLayer = displayedLayerId
    ? profile.layers.find((candidate) => candidate.id === displayedLayerId)
    : undefined

  const overrideCommand = displayedLayer?.overrides[key]
  if (overrideCommand) {
    return { key, kind: 'override', command: overrideCommand, layerName: displayedLayer!.name }
  }

  const baseCommand = profile.binds[key]
  if (baseCommand) {
    return { key, kind: 'base', command: baseCommand }
  }

  return { key, kind: 'unbound' }
}

/** Layer-switch state test mode tracks locally: which layer is on the board, and the currently-held hold trigger, if any. */
export interface TestModeSwitchState {
  displayedLayerId: string | null
  heldTrigger: { key: string; restoreLayerId: string | null } | null
}

/**
 * Apply a resolved `trigger` press to the layer-switch state (decisions 6-10).
 *
 * A `hold` layer's trigger puts that layer on the board and remembers what
 * was displayed before, so release can restore it; a second hold press
 * (whichever layer it belongs to) replaces the currently held trigger rather
 * than stacking — Q2 has no nested layers (016 D1 already refuses two held
 * modifiers), so a stack would model something the engine cannot do.
 *
 * A `toggle` layer's trigger flips between its own layer and base via
 * `triggerSelectTarget` (`trigger-keys.ts`), the same mapping the retired
 * click path used.
 *
 * Any other `TestPress` kind is not a trigger and leaves `state` unchanged.
 */
export function applyTriggerPress(
  state: TestModeSwitchState,
  press: TestPress,
): TestModeSwitchState {
  if (press.kind !== 'trigger') return state

  if (press.mode === 'hold') {
    return {
      displayedLayerId: press.layerId,
      heldTrigger: { key: press.key, restoreLayerId: state.displayedLayerId },
    }
  }

  // toggle: flip between this layer and base, unaffected by any held trigger.
  const isActive = state.displayedLayerId === press.layerId
  const target = triggerSelectTarget({ layerId: press.layerId, layerName: press.layerName, isActive })
  return { ...state, displayedLayerId: target }
}

/**
 * Apply the release of `key` to the layer-switch state (decision 8). Only a
 * release of the currently held hold-trigger's own key restores the layer
 * that was displayed before it was pressed; releasing any other key
 * (including a toggle trigger, which has no hold state) is a no-op.
 */
export function applyTriggerRelease(
  state: TestModeSwitchState,
  key: string,
): TestModeSwitchState {
  if (!state.heldTrigger || state.heldTrigger.key !== key) return state

  return { displayedLayerId: state.heldTrigger.restoreLayerId, heldTrigger: null }
}
