/**
 * Trigger-key resolution for the overview keyboard — story 014 D1.
 *
 * A layer's trigger key (story 011's `assignLayerTrigger`) is what puts that
 * layer's overrides on the board, so the board itself has to be able to
 * answer "is this key a trigger, and for which layer" without pulling in any
 * rendering concerns. That question is pure data lookup over `AltLayer[]` —
 * it needs no DOM, no store, no IPC — so it lives here as its own module
 * rather than inline in `OverviewKeyboardPanel`, exactly like
 * `validation-scope.ts` keeps its own aggregation separate from the panel
 * that renders it.
 */

import type { AltLayer } from '@shared/config/alt-layers'

/** One resolved trigger key: which layer it activates, and whether that layer is the one currently shown. */
export interface TriggerInfo {
  layerId: string
  layerName: string
  isActive: boolean
}

/**
 * Resolve whether `key` is some layer's trigger key. Trims both sides,
 * case-insensitive comparison. `layers` are scanned in array order and the
 * FIRST match wins (no cross-layer trigger-collision rule exists elsewhere,
 * so ties are broken by position only). A blank/absent `triggerKey` never
 * matches, and `key` is compared as given (callers pass the layout's key,
 * e.g. from KeyDef.key). `activeLayerId` is the layer currently shown on the
 * board (null = base layer) — isActive is true when the resolved layer IS
 * the one currently shown.
 */
export function resolveTriggerLayer(
  key: string,
  layers: readonly AltLayer[],
  activeLayerId: string | null,
): TriggerInfo | null {
  const target = key.trim().toLowerCase()

  const layer = layers.find((candidate) => {
    const trigger = candidate.triggerKey?.trim().toLowerCase() ?? ''
    // A blank trigger key means "this layer has no trigger" — it must never
    // match, even against an equally blank `key`, or every untriggered layer
    // would appear to fire on an empty keyboard key.
    if (!trigger) return false
    return trigger === target
  })

  if (!layer) return null

  return {
    layerId: layer.id,
    layerName: layer.name,
    isActive: layer.id === activeLayerId,
  }
}

/**
 * The layer id `onSelectLayer` should be called with when this trigger key
 * is clicked: `null` (base) when its own layer is the one currently active
 * (two-way toggle — using the trigger key again returns to base), otherwise
 * its layerId.
 */
export function triggerSelectTarget(info: TriggerInfo): string | null {
  return info.isActive ? null : info.layerId
}
