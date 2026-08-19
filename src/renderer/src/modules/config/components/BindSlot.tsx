import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BindCollision } from '@shared/config/bind-collision'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/primitives'
import type { ModifierSlotCollision, SlotCollision } from '../lib/bind-slot-collision'
import {
  classifyModifierCapture,
  resolveModifierRelease,
  type ModifierCaptureResult,
  type ModifierKey,
} from '../lib/modifier-capture'
import { useKeyCapture } from '../lib/useKeyCapture'

/**
 * Story 015 D4: a reusable Primary/Secondary bind slot for the catalogue-row
 * panels D5/D6 build next (`DualBindPanel`, `DropBindPanel`), each rendering
 * roughly 15-40 rows x 2 slots.
 *
 * Ownership choice (documented here for whoever builds D5/D6 next, per the
 * D4 deliverable note): `BindSlot` owns its own capture lifecycle via
 * `useKeyCapture` internally rather than taking `capturing`/`onStartCapture`
 * from its parent. The parent only controls `boundKey` and reacts to
 * `onAssign`/`onClear`. This is the simpler integration for a panel with many
 * rows - it does not need to track per-slot capture state itself - and it
 * leaves room for D7: `onAssign` hands the captured key to the parent, which
 * from D7 onward may hold it behind a collision banner (Cancel/Replace)
 * instead of committing it straight into `boundKey`.
 *
 * Story 015 D7: that room is now used. A capture no longer goes straight to
 * `onAssign` - it is first passed through the row's `checkCollision`, and the
 * two-tier outcome of that check is this component's own state:
 *
 * - nothing owns the key -> `onAssign`, exactly as in D4.
 * - only an alt layer owns it (decision 14) -> `onAssign` anyway, plus a
 *   non-blocking warning; a base bind and a layer override legitimately
 *   coexist (cf. `layer.triggerConflict`).
 * - a base bind or another action owns it (decision 13) -> nothing is applied.
 *   The captured key is parked in `pending` and the slot renders an inline
 *   Cancel/Replace banner instead, mirroring `AdvancedTab`'s category-delete
 *   confirm. Cancel fires no callback at all, so the slot is left exactly as
 *   it was; Replace hands the key *and* the collision back to the row, which
 *   is the only place that can release the previous owner in the same save
 *   (`applyReplace`).
 *
 * Story 016 D3: the capture is now classified before any of the above runs
 * (`classifyModifierCapture`), because a modifier held during a capture is not
 * a key at all - Quake 2 cannot bind "Alt+R", so that gesture belongs in an
 * alt layer instead of in this slot's `boundKey` (see `modifier-layers.ts`).
 * Four outcomes, and only one of them is 015's path:
 *
 * - `plain` -> everything above, byte for byte unchanged.
 * - `modifier` -> `onAssignModifier`, and nothing else. The row owns the layer
 *   upsert and its persist, the same way it already owns `onAssign`; this
 *   component only decides *that* the capture was a modifier one.
 * - `pending` / `refused` -> the capture stays open. A modifier's own keydown
 *   necessarily arrives before the key the user actually wants (decision 2),
 *   and a refusal (two modifiers, or a modifier as the pressed key) is a
 *   correctable mistake, so in both cases ending the capture would fight the
 *   user's hands.
 *
 * Story 016 D4: a modifier capture is no longer unconditionally immediate.
 * `checkModifierCollision` (the row's `findModifierSlotCollision` closure,
 * mirroring `checkCollision`'s shape) runs first; if the target layer's
 * override at that key already holds a *different* command, the capture is
 * parked in `pendingModifier` and the slot shows the same Cancel/Replace
 * banner shape as `pending` above instead of calling `onAssignModifier`
 * straight away. Cancel drops it with no callback at all (AC 6: "declining
 * leaves layers unchanged"); Replace calls `onAssignModifier` with exactly the
 * modifier/key it already resolved. An empty override, or one that already
 * holds this exact command (re-capturing the same row's own combo), is not a
 * collision and still applies immediately - the case this doc comment used to
 * describe as unconditional.
 *
 * Review-fix (post-D3): a `pending` classification alone can never turn into
 * a `plain` bind for a bare modifier key (see `resolveModifierRelease`'s doc
 * comment in `modifier-capture.ts`) - which silently broke binding a bare
 * modifier on its own (`bind SHIFT +speed`, a real stock Quake II bind, worked
 * before this story). `heldModifier` is this component's own session-state
 * half of the fix: it remembers which modifier a `pending` classification just
 * named, and `handleKeyUp` asks `resolveModifierRelease` whether *this* keyup
 * is that same modifier being let go with nothing else having happened - if
 * so, it is applied through the exact same path a `plain` keydown
 * classification takes (`applyPlainCapture`). Cleared on every other outcome
 * (`modifier`, `refused`, `plain`, a fresh `pending` for a different
 * modifier, cancel, or starting a new capture), so a keyup can only ever
 * resolve the *one* lone-modifier gesture that is still genuinely open.
 */

/** The two collision kinds that block an assignment (decision 13). */
type BlockingCollision = Exclude<BindCollision, { kind: 'layerOverride' }>

interface PendingCapture {
  key: string
  collision: BlockingCollision
  owner: string
}

const BLOCKING_MESSAGE_KEY: Record<BlockingCollision['kind'], string> = {
  baseBind: 'config.advanced.collision.baseBind',
  action: 'config.advanced.collision.action',
}

/** Why a modifier capture was refused - the inline hint the slot shows while staying in capture. */
type RefusedReason = Extract<ModifierCaptureResult, { kind: 'refused' }>['reason']

const MODIFIER_HINT_KEY: Record<RefusedReason, string> = {
  multipleModifiers: 'config.advanced.dualBind.modifierHint.multipleModifiers',
  modifierOnly: 'config.advanced.dualBind.modifierHint.modifierOnly',
}

/**
 * How a modifier reads in a composite slot label. Raw data, not translatable UI
 * prose: the badge next to it already shows untranslated engine tokens like
 * `MOUSE1`, and the layer these labels describe is itself named with the same
 * literal English token (decision 4, `MODIFIER_LAYER_NAME` in
 * `modifier-layers.ts`) - translating one half of `Alt+R` would only make the
 * slot and the Layers panel disagree.
 */
const MODIFIER_LABEL: Record<ModifierTrigger, string> = {
  ALT: 'Alt',
  CTRL: 'Ctrl',
  SHIFT: 'Shift',
}

export function BindSlot({
  label,
  boundKey,
  modifierDisplay,
  onAssign,
  onAssignModifier,
  onReplace,
  onClear,
  checkCollision,
  checkModifierCollision,
}: {
  /** Accessible name for this slot, e.g. "Primary" / "Secondary". */
  label: string
  boundKey: string | undefined
  /**
   * Story 016 D3: set by the row (via `findBindLocation`) only when `boundKey`
   * is undefined for this slot *and* this row's command currently lives inside
   * some modifier layer's overrides - so the slot can render a composite
   * `Alt+R` label instead of "not bound" for an assignment that exists entirely
   * inside a layer. Decision 9: nothing combined is ever persisted onto the
   * action for that case, so without this reverse lookup there is nothing in
   * `boundKey` to show. Ignored whenever `boundKey` is set - a base bind always
   * takes display priority.
   */
  modifierDisplay?: { modifier: ModifierTrigger; key: string }
  /** Applies the captured key. Called only when nothing blocks it. */
  onAssign: (key: string) => void
  /**
   * Story 016 D3: the capture resolved to a modifier+key gesture. Split from
   * `onAssign` the same way `onAssign`/`onReplace` are already split - this
   * component detects the classification, the row owns the actual layer upsert
   * and its persist (`upsertModifierLayerOverride` + `updateProfileLayers`),
   * because only the row knows this row's command string.
   */
  onAssignModifier: (input: { modifier: ModifierTrigger; key: string }) => void
  /**
   * Applies the captured key *and* releases it from `collision`'s owner in a
   * single save - see `applyReplace`. Called only from the Replace button.
   */
  onReplace: (key: string, collision: BindCollision) => void
  onClear: () => void
  /** Who, if anyone, already owns a key - the row's `findSlotCollision` closure. */
  checkCollision: (key: string) => SlotCollision | null
  /**
   * Story 016 D4: what a modifier capture's write would overwrite, if
   * anything - the row's `findModifierSlotCollision` closure, mirroring
   * `checkCollision`'s "ask the row, it owns the profile data" shape.
   */
  checkModifierCollision: (modifier: ModifierTrigger, key: string) => ModifierSlotCollision | null
}) {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)
  const [pending, setPending] = useState<PendingCapture | null>(null)
  const [pendingModifier, setPendingModifier] = useState<ModifierSlotCollision | null>(null)
  const [layerWarning, setLayerWarning] = useState<{ key: string; owner: string } | null>(null)
  const [refusedHint, setRefusedHint] = useState<RefusedReason | null>(null)
  // Review-fix (post-D3): which modifier a `pending` classification is
  // currently naming, so a later keyup with nothing else in between can be
  // resolved as a bare-modifier plain bind - see `resolveModifierRelease`.
  const [heldModifier, setHeldModifier] = useState<ModifierKey | null>(null)

  // Story 015's original unconditional path, extracted so both a `plain`
  // keydown classification and a resolved bare-modifier keyup
  // (`resolveModifierRelease`) apply through the exact same collision check -
  // one code path, not two copies that could drift.
  const applyPlainCapture = useCallback(
    (key: string) => {
      setCapturing(false)
      setPendingModifier(null)
      setHeldModifier(null)
      setRefusedHint(null)
      const found = checkCollision(key)

      if (found) {
        const { collision, owner } = found
        if (collision.kind !== 'layerOverride') {
          // Decision 13: not applied - the row keeps whatever it had until the
          // user picks Cancel or Replace below.
          setLayerWarning(null)
          setPending({ key, collision, owner })
          return
        }
        // Decision 14: applied, warned about. Layer overrides are written
        // through a different IPC channel entirely, so there is nothing to
        // release and nothing to confirm.
        setLayerWarning({ key, owner })
        onAssign(key)
        return
      }

      setLayerWarning(null)
      onAssign(key)
    },
    [checkCollision, onAssign],
  )

  const handleCapture = useCallback(
    ({
      key,
      modifiers,
    }: {
      key: string
      modifiers: { alt: boolean; ctrl: boolean; shift: boolean }
    }) => {
      // `key` is already through `resolveQuakeKeyName` (see `useKeyCapture`), so
      // the classification starts from the resolved name, not from a raw event.
      const classification = classifyModifierCapture(key, modifiers)

      if (classification.kind === 'pending') {
        // Decision 2: the first keydown of "hold Alt, then press R" is Alt's own
        // key. The capture must stay open - and the gesture is now valid again,
        // so a hint left over from an earlier refusal no longer applies. Track
        // which modifier this is, so a keyup with nothing else in between can
        // still resolve to a bare-modifier plain bind (review-fix).
        setRefusedHint(null)
        setHeldModifier(classification.modifier)
        return
      }

      if (classification.kind === 'refused') {
        // Stays in capture (D3 acceptance): releasing the extra modifier and
        // pressing the real key is the fix, and it needs the capture still live.
        // A second key already came down, so this is no longer a bare-modifier
        // tap - a following keyup must not resolve as one.
        setHeldModifier(null)
        setRefusedHint(classification.reason)
        return
      }

      if (classification.kind === 'modifier') {
        setCapturing(false)
        setPending(null)
        setLayerWarning(null)
        setRefusedHint(null)
        setHeldModifier(null)
        // Deliberately *not* routed through `checkCollision`: that helper
        // answers "who owns this key on the base layer", which is the wrong
        // question for an override living inside a layer.
        const modifierCollision = checkModifierCollision(
          classification.modifier,
          classification.key,
        )
        if (modifierCollision) {
          // Story 016 D4 (AC 6): a different action already occupies this
          // override - park it and wait for an explicit Cancel/Replace,
          // exactly like the base-layer `pending` case above.
          setPendingModifier(modifierCollision)
          return
        }
        onAssignModifier({ modifier: classification.modifier, key: classification.key })
        return
      }

      // `plain` - story 015's path, unchanged apart from reading the key off the
      // classification (identical value).
      applyPlainCapture(classification.key)
    },
    [applyPlainCapture, checkModifierCollision, onAssignModifier],
  )

  const handleKeyUp = useCallback(
    ({ key }: { key: string }) => {
      const released = resolveModifierRelease(heldModifier, key)
      if (released !== null) applyPlainCapture(released)
    },
    [heldModifier, applyPlainCapture],
  )

  const handleCancel = useCallback(() => {
    setCapturing(false)
    setHeldModifier(null)
  }, [])

  useKeyCapture(capturing, handleCapture, handleCancel, handleKeyUp)

  const startCapture = (): void => {
    setLayerWarning(null)
    setRefusedHint(null)
    setPendingModifier(null)
    setHeldModifier(null)
    setCapturing(true)
  }

  const clearKey = (): void => {
    setLayerWarning(null)
    onClear()
  }

  // `flex-wrap` (D7): the banner and the warning below are far wider than a
  // key badge, and the slot column they live in is a fixed `min-w-*` one in
  // both host panels - wrapping inside the column beats overflowing out of it.
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {pendingModifier ? (
        <>
          <span
            role="alert"
            className="rounded-sm border border-danger/35 bg-danger/8 px-2.5 py-1.5 text-xs text-danger"
          >
            {t('config.advanced.collision.modifierLayer', {
              key: `${MODIFIER_LABEL[pendingModifier.modifier]}+${pendingModifier.key}`,
              layer: pendingModifier.layerName,
              owner: pendingModifier.owner,
            })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPendingModifier(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const { modifier, key } = pendingModifier
              setPendingModifier(null)
              onAssignModifier({ modifier, key })
            }}
          >
            {t('config.advanced.collision.replace')}
          </Button>
        </>
      ) : pending ? (
        <>
          <span
            role="alert"
            className="rounded-sm border border-danger/35 bg-danger/8 px-2.5 py-1.5 text-xs text-danger"
          >
            {t(BLOCKING_MESSAGE_KEY[pending.collision.kind], {
              key: pending.key,
              owner: pending.owner,
            })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const { key, collision } = pending
              setPending(null)
              onReplace(key, collision)
            }}
          >
            {t('config.advanced.collision.replace')}
          </Button>
        </>
      ) : capturing ? (
        <>
          <Badge tone="warning">{t('config.advanced.editor.capturing')}</Badge>
          {refusedHint && (
            <span
              role="alert"
              className="rounded-sm border border-danger/35 bg-danger/8 px-2.5 py-1.5 text-xs text-danger"
            >
              {t(MODIFIER_HINT_KEY[refusedHint])}
            </span>
          )}
        </>
      ) : (
        <>
          {boundKey ? (
            <Badge tone="flame" className="numeric">
              {boundKey}
            </Badge>
          ) : modifierDisplay ? (
            <Badge tone="flame" className="numeric">
              {`${MODIFIER_LABEL[modifierDisplay.modifier]}+${modifierDisplay.key}`}
            </Badge>
          ) : (
            <span className="text-xs text-ink-muted">{t('config.advanced.editor.keyNotSet')}</span>
          )}
          {/* AC 3 (review finding): pressing a new key must replace whatever was there directly -
              an occupied slot still offers "capture" alongside Clear, mirroring `ActionEditor`'s
              idiom (always-visible capture button), rather than forcing Clear first. */}
          <Button variant="ghost" size="sm" onClick={startCapture}>
            {t('config.advanced.editor.captureKey')}
          </Button>
          {/* Still keyed on `boundKey` alone, deliberately: a `modifierDisplay`-only slot has
              nothing on the action to clear - the assignment lives in a layer's overrides, which
              the Layers panel owns (AC 7). Offering Clear here would either do nothing or need a
              second write path into `layers` that this story does not give the slot. */}
          {boundKey && (
            <Button variant="danger" size="sm" onClick={clearKey}>
              {t('config.advanced.editor.clearKey')}
            </Button>
          )}
        </>
      )}

      {!pending && layerWarning && (
        <span
          role="status"
          className="rounded-sm border border-warning/35 bg-warning/8 px-2.5 py-1.5 text-xs text-warning"
        >
          {t('config.advanced.collision.layerOverride', {
            key: layerWarning.key,
            owner: layerWarning.owner,
          })}
        </span>
      )}
    </div>
  )
}
