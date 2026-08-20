import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Square } from 'lucide-react'
import type { AltLayer } from '@shared/config/alt-layers'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { Button } from '../../components/ui/Button'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import { KeyBindDialog } from './components/KeyBindDialog'
import { LayerSwitcher } from './components/LayerSwitcher'
import { TestModeReadout } from './components/TestModeReadout'
import { keycapCommandLabel } from './lib/command-catalog'
import {
  ARROW_CLUSTER,
  KEYBOARD_ROWS,
  MOUSE_ROWS,
  NAV_CLUSTER,
  NUMPAD_KEYS,
  resolveAliasChain,
  resolveQuakeKeyName,
  type KeyDef,
} from './lib/keyboard-layout'
import {
  applyTriggerPress,
  applyTriggerRelease,
  resolveTestPress,
  type TestModeProfile,
  type TestModeSwitchState,
  type TestPress,
} from './lib/test-mode'
// `triggerSelectTarget` is not called here: 017 owns the click path (a keycap click edits, or in
// test mode reports) and 018 owns physical presses, where the toggle mapping is applied inside
// `lib/test-mode.ts`'s reducer instead (decisions 10 and 24).
import { resolveTriggerLayer, type TriggerInfo } from './lib/trigger-keys'

/** One keycap's footprint at 1x. The board is then zoomed to fill the panel - see the scale effect below. */
const KEY_UNIT_REM = 2.25
const KEY_HEIGHT_REM = 2.25
const KEY_GAP_REM = 0.3

/** Gap between the keyboard, nav/arrow, numpad and mouse blocks. */
const CLUSTER_GAP_REM = 1.5

/**
 * M1/M2's width in key-units, chosen so the two of them plus the CSS gap
 * between them exactly equal M3+M4+M5 plus their two gaps - not just the
 * same summed key width, since flex `gap` puts one more gap on the
 * three-key row than the two-key row above it. Solving `2w + gap = 3·1 +
 * 2·gap` for w gives `w = 1.5 + gap / (2·unit)`. Keeps the wheel keys - the
 * third column in both mouse rows - pixel-aligned instead of off by one gap.
 */
const MOUSE_WIDE_UNITS = 1.5 + KEY_GAP_REM / (2 * KEY_UNIT_REM)

/** How far the board scales to fill the panel - never shrunk to illegible, never blown up absurdly on an ultrawide. */
const MIN_SCALE = 0.55
const MAX_SCALE = 2

/** Test mode not running, or running with the base layer on the board and nothing held. */
const IDLE_TEST_SWITCH: TestModeSwitchState = { displayedLayerId: null, heldTrigger: null }

/**
 * Quake's mouse button numbering (018 decision 16) - not DOM order: the middle
 * button is `MOUSE3`, not `MOUSE2`. Keyed by `MouseEvent.button`.
 */
const MOUSE_BUTTON_NAMES: Record<number, string> = {
  0: 'MOUSE1',
  1: 'MOUSE3',
  2: 'MOUSE2',
  3: 'MOUSE4',
  4: 'MOUSE5',
}

/**
 * The config view's landing tab (CFG-7): a bound/free overview of the
 * profile's key binds - each keycap shows the friendly name of its
 * bound command (q2-config-manager's "what does this key do" feature) - plus
 * a test mode that captures a real keypress or mouse click and shows the
 * command chain it would run.
 *
 * Also the keybinding editor itself (story 006, made the default in story
 * 017): outside test mode, a keycap click opens `KeyBindDialog` for that key,
 * scoped to the base layer or, with a layer selected above this board, to
 * that layer's own `overrides` (concept doc §5 "Alternate binding layers").
 */
export function OverviewKeyboardPanel({
  profile,
  activeLayer,
  onChanged,
  onSelectLayer,
}: {
  profile: ConfigProfile
  activeLayer: AltLayer | null
  onChanged: (profiles: ConfigProfile[]) => void
  onSelectLayer: (layerId: string | null) => void
}) {
  const { t } = useTranslation()
  const [testMode, setTestMode] = useState(false)
  const [press, setPress] = useState<TestPress | null>(null)
  const [editingKey, setEditingKey] = useState<{ key: string; label: string } | null>(null)
  /**
   * Test mode's own view of the board (story 018 D3): which layer is displayed
   * and which `hold` trigger is currently down. Panel-local, and shaped exactly
   * like `lib/test-mode.ts`'s reducer state so the pure functions can be handed
   * the whole object. It is deliberately NOT a write to `ConfigView`'s
   * selection: a hold layer flipping that would drag `LayersPanel` along and
   * outlive test mode, which AC 5 forbids (decision 6).
   */
  const [testSwitch, setTestSwitch] = useState<TestModeSwitchState>(IDLE_TEST_SWITCH)
  /**
   * Quake key names currently physically held (story 018 D4, decision 13) - fed
   * by the same capturing keydown/keyup listeners below, so a keycap can light
   * up while held without touching `press`, which only tracks the latest one.
   */
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(() => new Set())
  /**
   * `testSwitch` as the window listeners see it. Rolling two keys - a trigger,
   * then a key on the layer it opens - fires two native events that can still
   * share one render, so a listener reading the rendered value would resolve
   * the second press against the layer that was on the board before the first:
   * the board shows one layer while the readout answers for another, the exact
   * failure this story removes. Every write goes through `commitTestSwitch`, so
   * ref and state never drift.
   */
  const testSwitchRef = useRef(testSwitch)
  /**
   * Physical `event.code` values currently holding each resolved Quake key
   * name down (018 bugfix): `ShiftLeft`/`ShiftRight` (and the Ctrl/Alt pairs)
   * both resolve to one Quake name, so `pressedKeys` alone cannot tell "still
   * held by the other physical key" from "released" - releasing one would
   * wrongly unlight the keycap and end a hold-trigger layer while its twin is
   * still down. Reference-counted per Quake name; keyboard only, since mouse
   * buttons are already distinct per raw button (`MOUSE_BUTTON_NAMES`).
   */
  const heldPhysicalCodesRef = useRef<Map<string, Set<string>>>(new Map())
  const scaleHostRef = useRef<HTMLDivElement>(null)
  const scaleTargetRef = useRef<HTMLDivElement>(null)

  const commitTestSwitch = (next: TestModeSwitchState): void => {
    testSwitchRef.current = next
    setTestSwitch(next)
  }

  /** The slice of the profile a press resolves against - identity-stable so the listeners are not re-bound per render. */
  const testProfile = useMemo<TestModeProfile>(
    () => ({
      binds: profile.binds,
      layers: profile.layers ?? [],
      actions: profile.actions ?? [],
    }),
    [profile.binds, profile.layers, profile.actions],
  )

  // Switching profile drops everything test mode was showing - AC 5's
  // profile-switch teardown. Test mode itself goes off, so the seeded layer and
  // any held trigger have to go with it or the next start would inherit a layer
  // from the profile you just left.
  useEffect(() => {
    setTestMode(false)
    setPress(null)
    setEditingKey(null)
    setPressedKeys(new Set())
    heldPhysicalCodesRef.current.clear()
    commitTestSwitch(IDLE_TEST_SWITCH)
  }, [profile.id])

  /**
   * Start/stop test mode. Starting borrows the currently selected layer as the
   * displayed one, so the board does not change under you the moment you press
   * Start (decision 7); stopping drops the local state, and since the selection
   * was never written, that alone restores what you were looking at (AC 5).
   */
  const toggleTestMode = (): void => {
    const next = !testMode
    setTestMode(next)
    setPress(null)
    setPressedKeys(new Set())
    heldPhysicalCodesRef.current.clear()
    commitTestSwitch(
      next ? { displayedLayerId: activeLayer?.id ?? null, heldTrigger: null } : IDLE_TEST_SWITCH,
    )
  }

  /**
   * Picking a layer above the board. The switcher shows the *displayed* layer
   * (decision 11), so in test mode it has to write that too - and it drops the
   * held trigger, because the layer that trigger's release would restore is no
   * longer the one you just asked for. The selection is always written as well,
   * so stopping test mode lands on whatever the switcher last said.
   */
  const selectLayer = (layerId: string | null): void => {
    if (testMode) commitTestSwitch({ displayedLayerId: layerId, heldTrigger: null })
    onSelectLayer(layerId)
  }

  // Test mode grabs the keyboard on purpose: `preventDefault` keeps a tested key
  // from also driving the UI, and `event.repeat` is ignored so auto-repeat cannot
  // re-fire a toggle layer once per repeat tick (decision 19).
  useEffect(() => {
    if (!testMode) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return
      event.preventDefault()
      if (event.repeat) return
      let codes = heldPhysicalCodesRef.current.get(quakeKey)
      if (!codes) {
        codes = new Set()
        heldPhysicalCodesRef.current.set(quakeKey, codes)
      }
      const wasHeld = codes.size > 0
      codes.add(event.code)
      if (!wasHeld) setPressedKeys((prev) => new Set(prev).add(quakeKey))
      const resolved = resolveTestPress(
        quakeKey,
        testProfile,
        testSwitchRef.current.displayedLayerId,
      )
      setPress(resolved)
      // A non-trigger press returns the state object unchanged, so this is a
      // no-op re-render-wise for ordinary keys.
      commitTestSwitch(applyTriggerPress(testSwitchRef.current, resolved))
    }
    const handleKeyUp = (event: KeyboardEvent): void => {
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return
      event.preventDefault()
      const codes = heldPhysicalCodesRef.current.get(quakeKey)
      codes?.delete(event.code)
      if (codes && codes.size > 0) return
      setPressedKeys((prev) => {
        if (!prev.has(quakeKey)) return prev
        const next = new Set(prev)
        next.delete(quakeKey)
        return next
      })
      // Only the held hold-trigger's own key restores the layer under it; every
      // other release, including a toggle trigger's, is a no-op (decision 8).
      commitTestSwitch(applyTriggerRelease(testSwitchRef.current, quakeKey))
    }
    // Focus loss is the release we will never see: without this the held
    // trigger's layer would stay on the board for good (AC 5). It ends the hold
    // and nothing else - a `toggle` layer is not held, so it stays displayed,
    // which is exactly how narrow "clears any hold-layer state" is.
    const handleBlur = (): void => {
      setPressedKeys(new Set())
      heldPhysicalCodesRef.current.clear()
      setPress(null)
      commitTestSwitch({ displayedLayerId: activeLayer?.id ?? null, heldTrigger: null })
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    // Not capturing: `blur` does not bubble, so a capturing window listener
    // would also fire for every element that loses focus inside the panel.
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [testMode, testProfile, activeLayer])

  // Physical mouse buttons (018 D5, decisions 16-18): same `pressedKeys` set
  // and resolve/commit pattern as the keydown effect above, so a mouse button
  // lights up its keycap exactly like a keyboard key. The wheel is excluded
  // entirely (decision 18) - no listener, no press/release semantics. Blur
  // clearing is already covered by the keydown effect's `handleBlur`, since
  // both effects write into the same `pressedKeys` state.
  useEffect(() => {
    if (!testMode) return
    const handleMouseDown = (event: MouseEvent): void => {
      const quakeButton = MOUSE_BUTTON_NAMES[event.button]
      if (!quakeButton) return
      setPressedKeys((prev) => new Set(prev).add(quakeButton))
      // A press that landed on a keycap is 017's click-to-capture path (it
      // already reports the clicked key); only empty panel space resolves the
      // mouse button itself into the readout (decision 17).
      const target = event.target as Element | null
      if (target?.closest('[data-keycap]')) return
      const resolved = resolveTestPress(
        quakeButton,
        testProfile,
        testSwitchRef.current.displayedLayerId,
      )
      setPress(resolved)
      commitTestSwitch(applyTriggerPress(testSwitchRef.current, resolved))
    }
    const handleMouseUp = (event: MouseEvent): void => {
      const quakeButton = MOUSE_BUTTON_NAMES[event.button]
      if (!quakeButton) return
      setPressedKeys((prev) => {
        if (!prev.has(quakeButton)) return prev
        const next = new Set(prev)
        next.delete(quakeButton)
        return next
      })
      commitTestSwitch(applyTriggerRelease(testSwitchRef.current, quakeButton))
    }
    window.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
    }
  }, [testMode, testProfile])

  // Scales the whole board to fill the panel's width - bigger on a
  // maximized/high-res window, shrunk (down to MIN_SCALE) rather than
  // scrolled on a narrow one. `zoom` (not `transform`) because it's a real
  // layout scale: the host's scrollable area grows/shrinks with it, so
  // there's no leftover blank space or a mis-sized scrollbar to reason
  // about. Re-measures natural width at zoom 1 each time, since reading
  // scrollWidth while already zoomed would feed back into itself.
  useLayoutEffect(() => {
    const host = scaleHostRef.current
    const target = scaleTargetRef.current
    if (!host || !target) return
    const recompute = (): void => {
      target.style.zoom = '1'
      const natural = target.scrollWidth
      if (natural === 0) return
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, host.clientWidth / natural))
      target.style.zoom = String(scale)
    }
    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const boundCount = Object.values(profile.binds).filter(
    (command) => command.trim().length > 0,
  ).length
  const totalCount = new Set([
    ...KEYBOARD_ROWS.flat()
      .filter((def) => def.key)
      .map((def) => def.key),
    ...NAV_CLUSTER.flat().map((def) => def.key),
    ...ARROW_CLUSTER.flat()
      .filter((def): def is KeyDef => def !== null)
      .map((def) => def.key),
    ...NUMPAD_KEYS.map((def) => def.key),
    ...MOUSE_ROWS.flat().map((def) => def.key),
  ]).size

  /**
   * The layer the board is actually drawing (decision 12). In test mode that is
   * test mode's own layer - a trigger key may just have put it there - and
   * outside it the layer selected above the board. `keyVisual`, `keyLabel` and
   * `capture` all read this, or 013/014's override, dim and trigger visuals
   * would keep describing the *selected* layer while the board claims to show
   * another one. `KeyBindDialog` deliberately does not: editing scope belongs to
   * the selection (017), never to whatever a held trigger happens to show.
   */
  const displayedLayer = testMode
    ? ((profile.layers ?? []).find((layer) => layer.id === testSwitch.displayedLayerId) ?? null)
    : activeLayer

  /**
   * The one click handler both keycap renderers wire up - a keycap click
   * means one of exactly two things: in test mode it reports what the key does
   * on the displayed layer (the readout fills in, nothing else happens - a
   * click never switches layers, it has no release and 017 owns the click path,
   * decision 24); otherwise it opens `KeyBindDialog` for that key, scoped to the
   * active layer if one is selected. Editing is the default state, not a mode
   * you switch into.
   */
  const capture = (def: KeyDef): void => {
    if (testMode) {
      setPress(resolveTestPress(def.key, testProfile, testSwitch.displayedLayerId))
      return
    }
    setEditingKey({ key: def.key, label: def.label })
  }

  /** Bound/free/shared styling and title shared by both the flex-row and grid keycap renderers. */
  const keyVisual = (def: KeyDef) => {
    const baseCommand = profile.binds[def.key]
    const baseBound = Boolean(baseCommand && baseCommand.trim().length > 0)
    const overrideCommand = displayedLayer?.overrides[def.key]
    const hasOverride = Boolean(
      displayedLayer && overrideCommand && overrideCommand.trim().length > 0,
    )
    const bound = hasOverride || baseBound
    const primaryCommand = hasOverride ? overrideCommand : baseCommand
    // A layer's trigger key is what puts that layer on the board, so its role
    // outranks whatever it is bound to: the keycap reads as a trigger first and
    // its own bind is demoted to the reference line below.
    const trigger = resolveTriggerLayer(def.key, profile.layers ?? [], displayedLayer?.id ?? null)
    const commandLabel =
      !trigger && bound && primaryCommand
        ? keycapCommandLabel(resolveAliasChain(primaryCommand, profile.actions ?? []))
        : null
    // When a layer is active and this key has no override of its own, the base
    // command still renders as the keycap's primary label (falling back below) -
    // this extra line only fires when the key DOES have an override, so the
    // base-layer command is not lost from view. A trigger key fires it too, and
    // regardless of `hasOverride`: a trigger is usually not overridden by its
    // own layer, but it very much can carry an ordinary base bind, and that has
    // to stay visible under the trigger label.
    const baseReferenceLabel =
      baseBound && (trigger || hasOverride)
        ? keycapCommandLabel(resolveAliasChain(baseCommand, profile.actions ?? []))
        : null
    const triggerTitle = trigger
      ? t('config.overview.trigger.title', { layer: trigger.layerName })
      : null
    const title = [
      def.key,
      trigger ? triggerTitle : hasOverride && t('config.overview.legend.altLayer'),
      !trigger && bound && primaryCommand?.trim(),
    ]
      .filter(Boolean)
      .join(' — ')
    const className = cn(
      'flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm border px-1 py-1 transition-colors duration-[--dur-fast]',
      trigger
        ? 'border-strogg-700 bg-strogg-900/35 text-strogg-200'
        : hasOverride
          ? 'border-warning/60 bg-warning/15 text-warning'
          : bound
            ? 'border-flame-700 bg-flame-900/30 text-flame-200'
            : 'border-line text-ink-muted',
      // A key with no override of its own, while a layer is active, is shown
      // dimmed - it is base-layer context, not this layer's own state. A trigger
      // key is never dimmed: it is what got you onto this layer.
      Boolean(displayedLayer) && !trigger && !hasOverride && bound && 'opacity-70',
      trigger ? 'cursor-pointer hover:border-strogg-300' : 'cursor-pointer hover:border-flame-400',
      // Physically held (018 D4, decision 14): a ring layered on top of whichever
      // tone already applies above, never a fourth colour of its own.
      pressedKeys.has(def.key) && 'ring-2 ring-inset ring-ink',
    )
    return { title, className, commandLabel, warn: hasOverride, baseReferenceLabel, trigger }
  }

  const keyLabel = (
    def: KeyDef,
    commandLabel: ReturnType<typeof keycapCommandLabel>,
    warn: boolean,
    baseReferenceLabel: ReturnType<typeof keycapCommandLabel>,
    trigger: TriggerInfo | null,
  ) => (
    <>
      <span className="text-[11px] leading-none font-semibold">{def.label}</span>
      {trigger ? (
        <span className="max-w-full truncate text-[8px] leading-none text-strogg-300/90">
          {t('config.overview.trigger.layerLabel', { layer: trigger.layerName })}
        </span>
      ) : (
        commandLabel && (
          <span
            className={cn(
              'max-w-full truncate text-[8px] leading-none',
              warn ? 'text-warning' : 'text-flame-300/90',
              !commandLabel.recognized && 'font-mono',
            )}
          >
            {commandLabel.label}
            {commandLabel.extraSteps > 0 && ` +${commandLabel.extraSteps}`}
          </span>
        )
      )}
      {baseReferenceLabel && (
        <span className="max-w-full truncate text-[7px] leading-none text-ink-muted italic opacity-80">
          {baseReferenceLabel.label}
        </span>
      )}
    </>
  )

  const renderKey = (def: KeyDef | null, index: number) => {
    if (!def || !def.key) {
      const widthUnits = def?.wide ? MOUSE_WIDE_UNITS : (def?.units ?? 1)
      return (
        <div
          key={`spacer-${index}`}
          style={{ width: `${widthUnits * KEY_UNIT_REM}rem`, height: `${KEY_HEIGHT_REM}rem` }}
        />
      )
    }
    const { title, className, commandLabel, warn, baseReferenceLabel, trigger } = keyVisual(def)
    const widthUnits = def.wide ? MOUSE_WIDE_UNITS : (def.units ?? 1)
    return (
      <button
        key={`${def.key}-${index}`}
        type="button"
        data-testid={`keycap-${def.key}`}
        data-keycap="true"
        title={title}
        onClick={() => capture(def)}
        style={{ width: `${widthUnits * KEY_UNIT_REM}rem`, height: `${KEY_HEIGHT_REM}rem` }}
        className={className}
      >
        {keyLabel(def, commandLabel, warn, baseReferenceLabel, trigger)}
      </button>
    )
  }

  /** Numpad only: grid placement (KP_PLUS/KP_ENTER span two rows, KP_INS spans two columns) instead of a fixed width/height. */
  const renderNumpadKey = (def: KeyDef, index: number) => {
    const { title, className, commandLabel, warn, baseReferenceLabel, trigger } = keyVisual(def)
    return (
      <button
        key={`${def.key}-${index}`}
        type="button"
        data-testid={`keycap-${def.key}`}
        data-keycap="true"
        title={title}
        onClick={() => capture(def)}
        style={{
          gridColumn: def.colSpan ? `span ${def.colSpan}` : undefined,
          gridRow: def.rowSpan ? `span ${def.rowSpan}` : undefined,
        }}
        className={className}
      >
        {keyLabel(def, commandLabel, warn, baseReferenceLabel, trigger)}
      </button>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <SectionLabel>{t('config.overview.label')}</SectionLabel>
          <p className="text-xs text-ink-muted">
            {t('config.overview.subtitle', { bound: boundCount, total: totalCount })}
          </p>
          <p className={cn('text-xs text-ink-muted', testMode && 'invisible')}>
            {t('config.overview.editHint')}
          </p>
        </div>
        <LayerSwitcher
          layers={profile.layers ?? []}
          activeLayerId={displayedLayer?.id ?? null}
          onSelect={selectLayer}
          className="flex flex-wrap items-center gap-2"
        />
        <div className="flex items-center gap-2">
          <Button
            variant={testMode ? 'danger' : 'neutral'}
            size="sm"
            icon={testMode ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
            onClick={toggleTestMode}
          >
            {testMode ? t('config.overview.testMode.stop') : t('config.overview.testMode.start')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{t('config.overview.legend.free')}</Badge>
          <Badge tone="flame">{t('config.overview.legend.bound')}</Badge>
          {/* Dimmed when no layer is on the board - which in test mode means the layer a trigger put there, so legend and board agree. */}
          <Badge tone="warning" className={cn(!displayedLayer && 'opacity-60')}>
            {t('config.overview.legend.altLayer')}
          </Badge>
          <Badge tone="strogg">{t('config.overview.legend.trigger')}</Badge>
          <Badge tone="neutral" className="ring-2 ring-inset ring-ink">
            {t('config.overview.legend.pressed')}
          </Badge>
        </div>
        {/*
          D6: the readout's home, right-hand cell under the test-mode button
          cluster above (same `justify-between` pattern as the header row).
          Renders unconditionally - `TestModeReadout` itself picks the inactive
          hint, the placeholder or a resolved press (decisions 20-21).
        */}
        <div className="min-w-0">
          <TestModeReadout press={press} testMode={testMode} actions={testProfile.actions} />
        </div>
      </div>

      <div ref={scaleHostRef} className="overflow-x-auto pb-2">
        <div
          ref={scaleTargetRef}
          className="flex items-start"
          style={{ gap: `${CLUSTER_GAP_REM}rem`, width: 'max-content' }}
        >
          <div className="flex flex-col" style={{ gap: `${KEY_GAP_REM}rem` }}>
            {KEYBOARD_ROWS.map((keyRow, rowIndex) => (
              <div key={rowIndex} className="flex" style={{ gap: `${KEY_GAP_REM}rem` }}>
                {keyRow.map((def, index) => renderKey(def, index))}
              </div>
            ))}
          </div>

          <div className="flex flex-col" style={{ gap: `${KEY_GAP_REM * 3}rem` }}>
            <div className="flex flex-col" style={{ gap: `${KEY_GAP_REM}rem` }}>
              {NAV_CLUSTER.map((keyRow, rowIndex) => (
                <div key={rowIndex} className="flex" style={{ gap: `${KEY_GAP_REM}rem` }}>
                  {keyRow.map((def, index) => renderKey(def, index))}
                </div>
              ))}
            </div>

            <div className="flex flex-col" style={{ gap: `${KEY_GAP_REM}rem` }}>
              {ARROW_CLUSTER.map((keyRow, rowIndex) => (
                <div key={rowIndex} className="flex" style={{ gap: `${KEY_GAP_REM}rem` }}>
                  {keyRow.map((def, index) => renderKey(def, index))}
                </div>
              ))}
            </div>
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(4, ${KEY_UNIT_REM}rem)`,
              gridAutoRows: `${KEY_HEIGHT_REM}rem`,
              gap: `${KEY_GAP_REM}rem`,
            }}
          >
            {NUMPAD_KEYS.map((def, index) => renderNumpadKey(def, index))}
          </div>

          <div className="flex flex-col" style={{ gap: `${KEY_GAP_REM}rem` }}>
            {MOUSE_ROWS.map((keyRow, rowIndex) => (
              <div key={rowIndex} className="flex" style={{ gap: `${KEY_GAP_REM}rem` }}>
                {keyRow.map((def, index) => renderKey(def, index))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingKey && (
        <KeyBindDialog
          profile={profile}
          keyName={editingKey.key}
          keyLabel={editingKey.label}
          layer={activeLayer}
          onClose={() => setEditingKey(null)}
          onSaved={(profiles) => {
            onChanged(profiles)
            setEditingKey(null)
          }}
        />
      )}
    </div>
  )
}
