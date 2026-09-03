import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import type { BindCollision } from '@shared/config/bind-collision'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
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
 *   Cancel/Replace banner instead, mirroring `ControlsTab`'s category-delete
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
 * - `modifier` -> `onAssignModifier`, and nothing else. The row owns the write,
 *   the same way it already owns `onAssign`; this component only decides *that*
 *   the capture was a modifier one.
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
 * Story 016 D9: a modifier is now part of the row's `ConfigAction` (the
 * `modifier` of the key slot this column maps onto - slot 0 or 1 of
 * `action.keys`, written by `applySlot`), which
 * collapses this component's display model to a single source. A slot shows
 * `boundKey`, prefixed with `boundModifier` when the pair carries one - there
 * is no longer a state where an assignment exists *only* inside a layer and
 * therefore had to be read back from `layers` for display. Consequently Clear
 * works for a modifier-bound slot exactly like any other: it clears one slot
 * on one action, and the layer override main derived from it disappears with
 * it (`applyActionLayerMirror`).
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
 *
 * Story 020 D5: the *surface* is rewritten, the state machine above is not.
 * The slot is now the always-visible `.ctrl-slot` cell of the Controls grid
 * (AC 6): one button per slot, never blank - "Empty" when unbound, the key
 * itself when bound, an `ALT` cap plus the key for a modifier bind, "Press a
 * key..." with the dashed capture pulse while capturing. Three things follow
 * from that cell being 190px wide and 30px tall:
 *
 * - The Clear button is gone. Clearing is `DEL` *while capturing* (story 020
 *   decision, AC 7, spelled out in the grid's footer legend) plus the row's
 *   own reset button - a 190px cell has no room for two ghost buttons.
 *   `DEL` intentionally never reaches `classifyModifierCapture`,
 *   `checkCollision` or `onAssign`, so the physical Delete key can no longer
 *   be bound from this slot (the Overview keycap path, story 017, still
 *   reaches it).
 * - Every wide message - the blocked-capture Cancel/Replace prompt, the
 *   refused-modifier hint, the layer-override warning - moves out of the cell
 *   into a full-width sub-row *under* the row (story 020 decision: "a 190px
 *   column cannot hold a sentence plus two buttons"). Mechanically that is a
 *   portal into the host element `ControlsRow` publishes through
 *   `BindPromptHostContext`; the prompt is still rendered by *this* component
 *   on every render, so its buttons always close over the freshest
 *   `onReplace`/`onAssignModifier` props. Handing the prompt up into the row's
 *   own state instead would have frozen those closures at park time, which is
 *   exactly how a Replace ends up applied to a stale actions array.
 * - No provider (the legacy `DualBindPanel`/`DropBindPanel`, which nothing
 *   renders since D3/D4) means no host, and the prompt falls back to the
 *   pre-020 inline placement - those panels keep working untouched.
 */

/**
 * Where a slot's wide messages go (story 020 decision: a blocked capture is a full-width
 * sub-row under its row, not a sentence plus two buttons stuffed into a 190px column).
 * `ControlsRow` publishes the host element it renders as a sibling of `.ctrl-row`; a slot with
 * no provider (`null`) renders them inline, where they were before story 020.
 */
export const BindPromptHostContext = createContext<HTMLElement | null>(null)

/**
 * The Primary/Secondary cell of a row that can never be bound - an alias entry (story 019: an
 * alias exists to be referenced by name, and binding one has to be *impossible* through the UI,
 * not merely discouraged). Deliberately not a `<button>`: it takes no focus and no click, so
 * there is no capture to refuse in the first place.
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
  isConflicted = false,
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
   * Story 016 D9: the modifier this slot's key was captured with, read straight
   * off the row's action (this column's own key slot, via `deriveRowState`'s
   * `primaryModifier`/`secondaryModifier`). Renders as a composite `Alt+R` label on the one badge -
   * not a second, competing source of what this slot shows, which is what the
   * removed `modifierDisplay` was. Meaningless without `boundKey`, and
   * `applySlot` cannot produce that combination.
   */
  boundModifier?: ModifierTrigger
  /**
   * Story 020 D5: is this the row's *Primary* slot? A bound primary slot is the strongest
   * element in its row (AC 6, `.ctrl-slot.is-primary-bound`). Presentation only - both slots
   * behave identically, and the legacy panels simply do not pass it.
   */
  isPrimary?: boolean
  /**
   * Story 020 D5: does this slot's key collide with another owner somewhere in the profile
   * (AC 8)? Marked with the danger border *and* a warning glyph - never colour alone (story 020
   * decision, accessibility floor). The scan that computes it is D7's `lib/bind-conflicts.ts`;
   * until that exists no caller passes it and every slot renders unmarked.
   */
  isConflicted?: boolean
  /** Applies the captured key. Called only when nothing blocks it. */
  onAssign: (key: string) => void
  /**
   * Story 016 D3: the capture resolved to a modifier+key gesture. Split from
   * `onAssign` the same way `onAssign`/`onReplace` are already split - this
   * component detects the classification, the row owns the write. Since D9 that
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

  /**
   * Story 020 D5: clearing this slot. Reached from `DEL` during a capture (a 190px cell has no
   * room for a Clear button any more) and from nowhere else in this component - the row's reset
   * button clears both of its slots through its own `onReset`.
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
      // Story 020 D5 (AC 7, story 020 decision): `DEL` clears the slot instead of binding the
      // physical Delete key. Deliberately *ahead* of the classification and of
      // `checkCollision`, so a Delete keypress can never be parked as a `pending` capture,
      // never be routed into a modifier layer and never be written as a bind - a slot cannot
      // mean both "clear me" and "bind DEL". `resolveQuakeKeyName` still resolves Delete to
      // `'DEL'`, so the Overview keycap path (story 017) reaches that key as before.
      if (key === 'DEL') {
        clearSlot()
        return
      }

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
   * Everything that does not fit in the cell: the two Cancel/Replace prompts (decision 13's
   * base-layer collision and 016 D4's modifier-layer one), the refused-modifier hint and the
   * non-blocking layer-override warning (decision 14 - applied, warned about). Same wording,
   * same button pair, same precedence chain as before D5 - `pendingModifier` over `pending`,
   * and the layer warning only while nothing is parked (`startCapture` clears it, so it can
   * never be live at the same time as `refusedHint`). Only the placement changed.
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
  if (capturing) {
    slotClasses.push('is-capturing')
  } else if (boundKey) {
    slotClasses.push('is-bound')
    // AC 6: in the prototype every row whose Primary column carries a key renders it as the
    // row's strongest element - so this is "the primary slot, bound", not "any slot of a bound
    // row".
    if (isPrimary) slotClasses.push('is-primary-bound')
  }
  if (showConflict) slotClasses.push('is-conflict')

  // The accessible name carries the *value*, because `aria-label` replaces the cell's text
  // content: without it a screen reader would announce "Primary" and never the key.
  const valueText = capturing
    ? t('config.controls.editor.capturing')
    : boundKey
      ? boundModifier
        ? `${boundModifier} ${boundKey}`
        : boundKey
      : t('config.controls.editor.empty')

  return (
    <>
      <button
        type="button"
        className={slotClasses.join(' ')}
        aria-label={t(
          showConflict
            ? 'config.controls.editor.slotLabelConflict'
            : 'config.controls.editor.slotLabel',
          { slot: label, value: valueText },
        )}
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
        ) : (
          <span className="ctrl-slot-empty">{t('config.controls.editor.empty')}</span>
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
