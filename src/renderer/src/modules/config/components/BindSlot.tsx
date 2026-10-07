import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Plus, TriangleAlert } from 'lucide-react'
import type { BindCollision } from '@shared/config/validation/bind-collision'
import type { ModifierTrigger } from '@shared/config/aliases/modifier-layers'
import { Button } from '../../../components/ui/Button'
import type { ModifierSlotCollision, SlotCollision } from '../lib/bind-slot-collision'
import {
  classifyModifierCapture,
  resolveModifierRelease,
  type ModifierCaptureResult,
  type ModifierKey,
} from '../lib/modifier-capture'
import { useKeyCapture } from '../lib/useKeyCapture'

/**
 * A reusable Primary/Secondary bind slot for the catalogue rows.
 *
 * `BindSlot` owns its own capture lifecycle via `useKeyCapture` rather than taking
 * `capturing`/`onStartCapture` from its parent, so a panel of many rows tracks no per-slot capture
 * state. The parent controls `boundKey` and reacts to `onAssign`/`onClear`.
 *
 * A capture is first classified (`classifyModifierCapture`), because a modifier held during a
 * capture is not a key at all - Quake 2 cannot bind "Alt+R", so that gesture belongs in an alt layer
 * (see `modifier-layers.ts`). A plain capture is then passed through the row's `checkCollision`, whose
 * two-tier outcome is this component's own state:
 *
 * - nothing owns the key -> `onAssign`.
 * - only an alt layer owns it (decision 14) -> `onAssign` anyway, plus a non-blocking warning
 *   (a base bind and a layer override legitimately coexist; cf. `layer.triggerConflict`).
 * - a base bind or another action owns it (decision 13) -> nothing is applied.
 *   The captured key is parked in `pending` and the slot renders an inline
 *   Cancel/Replace banner instead. Cancel fires no callback at all; Replace hands the key *and* the
 *   collision back to the row, the only place that can release the previous owner in the same save
 *   (`applyReplace`).
 *
 * Capture outcomes: `plain` -> everything above; `modifier` -> `onAssignModifier` only (the row owns
 * the write); `pending` / `refused` -> the capture stays open, because a modifier's own keydown
 * arrives before the key the user wants (decision 2) and a refusal (two modifiers, or a modifier as
 * the pressed key) is a correctable mistake.
 *
 * A modifier capture first runs `checkModifierCollision` (the row's `findModifierSlotCollision`
 * closure); if the target layer's override at that key already holds a *different* command, it is
 * parked in `pendingModifier` and the slot shows the same Cancel/Replace
 * banner shape as `pending` above instead of calling `onAssignModifier` straight away. Cancel drops
 * it with no callback; Replace calls `onAssignModifier` with the modifier/key it already resolved.
 * An empty override, or one already holding this exact command (re-capturing the same row's own
 * combo), is not a collision and applies immediately.
 *
 * A modifier is part of the row's `ConfigAction` (the `modifier` of the key slot this column maps
 * onto, written by `applySlot`), so the display model has a single source: a slot shows `boundKey`,
 * prefixed with `boundModifier` when the pair carries one. Clear works for a modifier-bound slot
 * like any other; the layer override main derived from it disappears with it
 * (`applyActionLayerMirror`).
 *
 * A `pending` classification alone can never turn into a `plain` bind for a bare modifier key (see
 * `resolveModifierRelease` in `modifier-capture.ts`), which would break binding a bare modifier on
 * its own (`bind SHIFT +speed`, a real stock Quake II bind). `heldModifier` remembers which modifier
 * a `pending` classification just named; `handleKeyUp` asks `resolveModifierRelease` whether *this*
 * keyup is that modifier being let go with nothing else having happened, and if so applies it
 * through the `plain` path (`applyPlainCapture`). Every other outcome (`modifier`, `refused`,
 * `plain`, a `pending` for a different modifier, cancel, a new capture) clears it, so a keyup can
 * only resolve the one lone-modifier gesture still genuinely open.
 *
 * The slot is the always-visible `.ctrl-slot` cell of the Controls grid: one button per slot, never
 * blank - "Empty" when unbound, the key when bound, an `ALT` cap plus the key for a modifier bind,
 * "Press a key..." with the dashed capture pulse while capturing. The cell is 190px wide and 30px
 * tall, so:
 *
 * - There is no Clear button. Clearing is `DEL` *while capturing* (spelled out in the grid's footer
 *   legend) plus the row's own reset button. `DEL` never reaches `classifyModifierCapture`,
 *   `checkCollision` or `onAssign`, so the physical Delete key cannot be bound from this slot (the
 *   Overview keycap path still reaches it).
 * - Every wide message - the blocked-capture Cancel/Replace prompt, the refused-modifier hint, the
 *   layer-override warning - renders in a full-width sub-row *under* the row: a portal into the host
 *   element `ControlsRow` publishes through `BindPromptHostContext`. The prompt is rendered by
 *   *this* component on every render so its buttons close over the freshest
 *   `onReplace`/`onAssignModifier` props; handing it up into the row's state would freeze those
 *   closures at park time and apply a Replace to a stale actions array.
 * - No provider means no host, and the prompt falls back to inline placement.
 */

/**
 * Where a slot's wide messages go (the decision: a blocked capture is a full-width
 * sub-row under its row, not a sentence plus two buttons stuffed into a 190px column).
 * `ControlsRow` publishes the host element it renders as a sibling of `.ctrl-row`; a slot with
 * no provider (`null`) renders them inline, where they were before the grid.
 */
export const BindPromptHostContext = createContext<HTMLElement | null>(null)

/**
 * The cell of a row that can never be bound (an alias entry is referenced by name, so binding it
 * must be impossible). Not a `<button>`: no focus, no click, nothing to refuse.
 */
export function BindSlotPlaceholder() {
  const { t } = useTranslation()
  return (
    <span className="ctrl-slot is-inert">
      <span className="sr-only">{t('config.controls.editor.notBindable')}</span>
      <span aria-hidden="true">&mdash;</span>
    </span>
  )
}

/** The two collision kinds that block an assignment (decision 13). */
type BlockingCollision = Exclude<BindCollision, { kind: 'layerOverride' }>

interface PendingCapture {
  key: string
  collision: BlockingCollision
  owner: string
}

const BLOCKING_MESSAGE_KEY: Record<BlockingCollision['kind'], string> = {
  baseBind: 'config.controls.collision.baseBind',
  action: 'config.controls.collision.action',
}

/** Why a modifier capture was refused - the inline hint the slot shows while staying in capture. */
type RefusedReason = Extract<ModifierCaptureResult, { kind: 'refused' }>['reason']

const MODIFIER_HINT_KEY: Record<RefusedReason, string> = {
  multipleModifiers: 'config.controls.dualBind.modifierHint.multipleModifiers',
  modifierOnly: 'config.controls.dualBind.modifierHint.modifierOnly',
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
  boundModifier,
  isPrimary = false,
  compactAdd = false,
  isConflicted = false,
  disabled = false,
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
   * the modifier this slot's key was captured with, read straight
   * off the row's action (this column's own key slot, via `deriveRowState`'s
   * `primaryModifier`/`secondaryModifier`). Renders as a composite `Alt+R` label on the one badge -
   * not a second, competing source of what this slot shows, which is what the
   * removed `modifierDisplay` was. Meaningless without `boundKey`, and
   * `applySlot` cannot produce that combination.
   */
  boundModifier?: ModifierTrigger
  /**
   * is this the row's *Primary* slot? A bound primary slot is the strongest
   * element in its row. Presentation only - both slots
   * behave identically, and the legacy panels simply do not pass it.
   */
  isPrimary?: boolean
  /** Compact add affordance in rows that already contain two bindings. */
  compactAdd?: boolean
  /**
   * Does this slot's key collide with another owner somewhere in the profile? Marked with the
   * danger border *and* a warning glyph - never colour alone. Computed by `lib/bind-conflicts.ts`.
   */
  isConflicted?: boolean
  /**
   * the row's action cannot work on the profile's assigned engine(s), so the slot
   * takes no capture (mouse or keyboard). A bound key stays shown and is never removed by this.
   * The reason is rendered as text by the row, not here.
   */
  disabled?: boolean
  /** Applies the captured key. Called only when nothing blocks it. */
  onAssign: (key: string) => void
  /**
   * the capture resolved to a modifier+key gesture. Split from
   * `onAssign` the same way `onAssign`/`onReplace` are already split - this
   * component detects the classification, the row owns the write; that
   * write is the same `applySlot` + action save `onAssign` uses, with the
   * modifier passed along; the modifier layer and its override are derived from
   * the saved action by main, not written here.
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
   * What a modifier capture's write would overwrite - the row's `findModifierSlotCollision` closure.
   */
  checkModifierCollision: (modifier: ModifierTrigger, key: string) => ModifierSlotCollision | null
}) {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)
  const [pending, setPending] = useState<PendingCapture | null>(null)
  const [pendingModifier, setPendingModifier] = useState<ModifierSlotCollision | null>(null)
  const [layerWarning, setLayerWarning] = useState<{ key: string; owner: string } | null>(null)
  const [refusedHint, setRefusedHint] = useState<RefusedReason | null>(null)
  // which modifier a `pending` classification is
  // currently naming, so a later keyup with nothing else in between can be
  // resolved as a bare-modifier plain bind - see `resolveModifierRelease`.
  const [heldModifier, setHeldModifier] = useState<ModifierKey | null>(null)

  // Shared by a `plain` keydown and a resolved bare-modifier keyup (`resolveModifierRelease`) so both
  // go through the same collision check.
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
          // Decision 13: not applied until the user picks Cancel or Replace below.
          setLayerWarning(null)
          setPending({ key, collision, owner })
          return
        }
        // Decision 14: applied, warned about; layer overrides use a different IPC channel, so
        // there is nothing to release or confirm.
        setLayerWarning({ key, owner })
        onAssign(key)
        return
      }

      setLayerWarning(null)
      onAssign(key)
    },
    [checkCollision, onAssign],
  )

  /**
   * clearing this slot. Reached only from `DEL` during a capture; the row's reset clears both slots.
   */
  const clearSlot = useCallback(() => {
    setCapturing(false)
    setPending(null)
    setPendingModifier(null)
    setLayerWarning(null)
    setRefusedHint(null)
    setHeldModifier(null)
    onClear()
  }, [onClear])

  const handleCapture = useCallback(
    ({
      key,
      modifiers,
    }: {
      key: string
      modifiers: { alt: boolean; ctrl: boolean; shift: boolean }
    }) => {
      // `DEL` clears the slot instead of binding the
      // physical Delete key. Deliberately *ahead* of the classification and of
      // `checkCollision`, so a Delete keypress can never be parked as a `pending` capture,
      // never be routed into a modifier layer and never be written as a bind - a slot cannot
      // mean both "clear me" and "bind DEL". `resolveQuakeKeyName` still resolves Delete to
      // `'DEL'`, so the Overview keycap path reaches that key as before.
      if (key === 'DEL') {
        clearSlot()
        return
      }

      // `key` is already through `resolveQuakeKeyName` (see `useKeyCapture`), so
      // the classification starts from the resolved name, not from a raw event.
      const classification = classifyModifierCapture(key, modifiers)

      if (classification.kind === 'pending') {
        // Decision 2: the first keydown of "hold Alt, then press R" is Alt's own key, so the capture
        // stays open and a stale refusal hint is dropped. Track the modifier so a keyup with nothing
        // in between can still resolve to a bare-modifier plain bind.
        setRefusedHint(null)
        setHeldModifier(classification.modifier)
        return
      }

      if (classification.kind === 'refused') {
        // Stays in capture: releasing the extra modifier and
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
        // Not `checkCollision`: that answers "who owns this key on the base layer", the wrong
        // question for an override living inside a layer.
        const modifierCollision = checkModifierCollision(
          classification.modifier,
          classification.key,
        )
        if (modifierCollision) {
          // A different action already occupies this
          // override - park it and wait for an explicit Cancel/Replace,
          // exactly like the base-layer `pending` case above.
          setPendingModifier(modifierCollision)
          return
        }
        onAssignModifier({ modifier: classification.modifier, key: classification.key })
        return
      }

      applyPlainCapture(classification.key)
    },
    [applyPlainCapture, checkModifierCollision, clearSlot, onAssignModifier],
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

  const promptHost = useContext(BindPromptHostContext)

  /**
   * Everything that does not fit in the cell: the two Cancel/Replace prompts (base-layer and
   * modifier-layer collision), the refused-modifier hint and the non-blocking layer-override
   * warning. `pendingModifier` wins over `pending`, and the layer warning shows only while nothing
   * is parked (`startCapture` clears it, so it is never live with `refusedHint`).
   */
  const prompt: ReactNode = pendingModifier ? (
    <>
      <span role="alert" className="text-xs text-danger">
        {t('config.controls.collision.modifierLayer', {
          key: `${MODIFIER_LABEL[pendingModifier.modifier]}+${pendingModifier.key}`,
          layer: pendingModifier.layerName,
          owner: pendingModifier.owner,
        })}
      </span>
      <Button variant="ghost" size="sm" onClick={() => setPendingModifier(null)}>
        {t('common.action.cancel')}
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
        {t('config.controls.collision.replace')}
      </Button>
    </>
  ) : pending ? (
    <>
      <span role="alert" className="text-xs text-danger">
        {t(BLOCKING_MESSAGE_KEY[pending.collision.kind], {
          key: pending.key,
          owner: pending.owner,
        })}
      </span>
      <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
        {t('common.action.cancel')}
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
        {t('config.controls.collision.replace')}
      </Button>
    </>
  ) : refusedHint ? (
    <span role="alert" className="text-xs text-danger">
      {t(MODIFIER_HINT_KEY[refusedHint])}
    </span>
  ) : layerWarning ? (
    <span role="status" className="text-xs text-warning">
      {t('config.controls.collision.layerOverride', {
        key: layerWarning.key,
        owner: layerWarning.owner,
      })}
    </span>
  ) : null

  // A conflict marker only means something on a key that is actually on screen: mid-capture the
  // cell reads "Press a key..." and has no key to be in conflict about.
  const showConflict = isConflicted && Boolean(boundKey) && !capturing

  const slotClasses = ['ctrl-slot']
  if (compactAdd && !boundKey && !capturing) slotClasses.push('ctrl-slot-add')
  if (capturing) {
    slotClasses.push('is-capturing')
  } else if (boundKey) {
    slotClasses.push('is-bound')
    // in the prototype every row whose Primary column carries a key renders it as the
    // row's strongest element - so this is "the primary slot, bound", not "any slot of a bound
    // row".
    if (isPrimary) slotClasses.push('is-primary-bound')
  }
  if (showConflict) slotClasses.push('is-conflict')
  if (disabled) slotClasses.push('is-disabled')

  // The accessible name carries the *value*, because `aria-label` replaces the cell's text
  // content: without it a screen reader would announce "Primary" and never the key.
  const valueText = capturing
    ? t('config.controls.editor.capturing')
    : boundKey
      ? boundModifier
        ? `${boundModifier} ${boundKey}`
        : boundKey
      : t('common.label.empty')

  return (
    <>
      <button
        type="button"
        className={slotClasses.join(' ')}
        title={compactAdd && !boundKey ? t('config.controls.grid.keyAdd') : undefined}
        aria-label={
          compactAdd && !boundKey && !capturing
            ? t('config.controls.grid.keyAdd')
            : t(
                showConflict
                  ? 'config.controls.editor.slotLabelConflict'
                  : 'config.controls.editor.slotLabel',
                { slot: label, value: valueText },
              )
        }
        disabled={disabled}
        aria-disabled={disabled || undefined}
        onClick={startCapture}
      >
        {capturing ? (
          t('config.controls.editor.capturing')
        ) : boundKey ? (
          <>
            {/* The modifier is a small cap next to the key (`ALT R`), not a `+`-joined string:
                the engine has no combined token to store, and the cap is what the prototype
                shows. The trigger token stays untranslated - see `MODIFIER_LABEL`. */}
            {boundModifier && <span className="ctrl-cap">{boundModifier}</span>}
            <span className="numeric">{boundKey}</span>
            {showConflict && <TriangleAlert className="size-3" aria-hidden="true" />}
          </>
        ) : compactAdd ? (
          <Plus aria-hidden className="size-3.5" />
        ) : (
          <span className="ctrl-slot-empty">{t('common.label.empty')}</span>
        )}
      </button>

      {prompt !== null &&
        (promptHost ? (
          createPortal(<div className="ctrl-subrow">{prompt}</div>, promptHost)
        ) : (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
            {prompt}
          </div>
        ))}
    </>
  )
}
