import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Square } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { Button } from '../../components/ui/Button'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import { keycapCommandLabel, resolveCommandLabel } from './lib/command-catalog'
import {
  ARROW_CLUSTER,
  KEYBOARD_ROWS,
  MOUSE_ROWS,
  NAV_CLUSTER,
  NUMPAD_KEYS,
  keyOccurrenceCounts,
  resolveAliasChain,
  resolveQuakeKeyName,
  type KeyDef,
} from './lib/keyboard-layout'

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

/**
 * Max height of the test-mode readout strip, in rem - about two lines. It
 * never grows past that with the captured chain's length, so pressing a
 * different key while testing doesn't jump the layout around; a longer
 * chain scrolls inside the strip instead.
 */
const CAPTURE_MAX_HEIGHT_REM = 3.5

interface Captured {
  key: string
  command: string | undefined
}

/**
 * The config view's landing tab (CFG-7): a bound/free/doubly-bound overview
 * of the profile's key binds - each keycap shows the friendly name of its
 * bound command (q2-config-manager's "what does this key do" feature) - plus
 * a test mode that captures a real keypress or mouse click and shows the
 * command chain it would run.
 *
 * Read-only by design - editing binds is the keybinding editor's job (a
 * later story, concept doc §5 "Alternate binding layers"), not this one.
 */
export function OverviewKeyboardPanel({ profile }: { profile: ConfigProfile }) {
  const { t } = useTranslation()
  const occurrences = useMemo(() => keyOccurrenceCounts(), [])
  const [testMode, setTestMode] = useState(false)
  const [captured, setCaptured] = useState<Captured | null>(null)
  const scaleHostRef = useRef<HTMLDivElement>(null)
  const scaleTargetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTestMode(false)
    setCaptured(null)
  }, [profile.id])

  useEffect(() => {
    if (!testMode) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return
      event.preventDefault()
      if (event.repeat) return
      setCaptured({ key: quakeKey, command: profile.binds[quakeKey] })
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [testMode, profile.binds])

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

  const capture = (key: string): void => {
    if (!testMode) return
    setCaptured({ key, command: profile.binds[key] })
  }

  /** Bound/free/shared styling and title shared by both the flex-row and grid keycap renderers. */
  const keyVisual = (def: KeyDef) => {
    const command = profile.binds[def.key]
    const bound = Boolean(command && command.trim().length > 0)
    const commandLabel = bound ? keycapCommandLabel(resolveAliasChain(command)) : null
    const conflict = (occurrences.get(def.key) ?? 0) > 1
    const title = [def.key, conflict && t('config.overview.legend.conflict'), bound && command?.trim()]
      .filter(Boolean)
      .join(' — ')
    const className = cn(
      'flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-sm border px-1 py-1 transition-colors duration-[--dur-fast]',
      bound ? 'border-flame-700 bg-flame-900/30 text-flame-200' : 'border-line text-ink-muted',
      conflict && 'ring-1 ring-strogg-500/60 ring-inset',
      testMode ? 'cursor-pointer hover:border-flame-400' : 'cursor-default',
    )
    return { title, className, commandLabel }
  }

  const keyLabel = (def: KeyDef, commandLabel: ReturnType<typeof keycapCommandLabel>) => (
    <>
      <span className="text-[11px] leading-none font-semibold">{def.label}</span>
      {commandLabel && (
        <span
          className={cn(
            'max-w-full truncate text-[8px] leading-none text-flame-300/90',
            !commandLabel.recognized && 'font-mono',
          )}
        >
          {commandLabel.label}
          {commandLabel.extraSteps > 0 && ` +${commandLabel.extraSteps}`}
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
    const { title, className, commandLabel } = keyVisual(def)
    const widthUnits = def.wide ? MOUSE_WIDE_UNITS : (def.units ?? 1)
    return (
      <button
        key={`${def.key}-${index}`}
        type="button"
        title={title}
        onClick={() => capture(def.key)}
        style={{ width: `${widthUnits * KEY_UNIT_REM}rem`, height: `${KEY_HEIGHT_REM}rem` }}
        className={className}
      >
        {keyLabel(def, commandLabel)}
      </button>
    )
  }

  /** Numpad only: grid placement (KP_PLUS/KP_ENTER span two rows, KP_INS spans two columns) instead of a fixed width/height. */
  const renderNumpadKey = (def: KeyDef, index: number) => {
    const { title, className, commandLabel } = keyVisual(def)
    return (
      <button
        key={`${def.key}-${index}`}
        type="button"
        title={title}
        onClick={() => capture(def.key)}
        style={{
          gridColumn: def.colSpan ? `span ${def.colSpan}` : undefined,
          gridRow: def.rowSpan ? `span ${def.rowSpan}` : undefined,
        }}
        className={className}
      >
        {keyLabel(def, commandLabel)}
      </button>
    )
  }

  const chain = resolveAliasChain(captured?.command)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <SectionLabel>{t('config.overview.label')}</SectionLabel>
          <p className="text-xs text-ink-muted">
            {t('config.overview.subtitle', { bound: boundCount, total: totalCount })}
          </p>
        </div>
        <Button
          variant={testMode ? 'danger' : 'neutral'}
          size="sm"
          icon={testMode ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
          onClick={() => setTestMode((prev) => !prev)}
        >
          {testMode ? t('config.overview.testMode.stop') : t('config.overview.testMode.start')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{t('config.overview.legend.free')}</Badge>
        <Badge tone="flame">{t('config.overview.legend.bound')}</Badge>
        <Badge tone="strogg">{t('config.overview.legend.conflict')}</Badge>
        {/* Alt layers are CFG-8 - no key can carry this state yet, but the
            legend names it up front so the overview reads the same as
            q2-config-manager's once that story lands. */}
        <Badge tone="neutral" className="opacity-60">
          {t('config.overview.legend.altLayer')}
        </Badge>
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

            {testMode && (
              <div
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 overflow-y-auto rounded-sm border border-line bg-panel px-2.5 py-1.5 text-xs"
                style={{ maxHeight: `${CAPTURE_MAX_HEIGHT_REM}rem` }}
              >
                {captured ? (
                  <>
                    <span className="stencil shrink-0">{captured.key}</span>
                    {chain.length === 0 ? (
                      <span className="text-ink-muted">{t('config.overview.testMode.noBind')}</span>
                    ) : (
                      chain.map((step, index) => {
                        const resolved = resolveCommandLabel(step)
                        return (
                          <span key={index} className="flex items-center gap-1 text-ink-dim">
                            {index > 0 && <span className="text-ink-muted">{'→'}</span>}
                            {resolved.recognized ? resolved.label : <code>{step}</code>}
                          </span>
                        )
                      })
                    )}
                  </>
                ) : (
                  <span className="text-ink-muted">{t('config.overview.testMode.placeholder')}</span>
                )}
              </div>
            )}
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
    </div>
  )
}
