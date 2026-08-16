import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Square } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { Button } from '../../components/ui/Button'
import { Badge, Panel, SectionLabel } from '../../components/ui/primitives'
import {
  ARROW_CLUSTER,
  KEYBOARD_ROWS,
  MOUSE_KEYS,
  NAV_CLUSTER,
  keyOccurrenceCounts,
  resolveAliasChain,
  resolveQuakeKeyName,
  type KeyDef,
} from './lib/keyboard-layout'

const KEY_UNIT_REM = 2.75

interface Captured {
  key: string
  command: string | undefined
}

/**
 * The config view's landing tab (CFG-7): a bound/free/doubly-bound overview
 * of the profile's key binds, plus a test mode that captures a real keypress
 * or mouse click and shows the command chain it would run.
 *
 * Read-only by design - editing binds is the keybinding editor's job (a
 * later story, concept doc §5 "Alternate binding layers"), not this one.
 */
export function OverviewKeyboardPanel({ profile }: { profile: ConfigProfile }) {
  const { t } = useTranslation()
  const occurrences = useMemo(() => keyOccurrenceCounts(), [])
  const [testMode, setTestMode] = useState(false)
  const [captured, setCaptured] = useState<Captured | null>(null)

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

  const boundCount = Object.values(profile.binds).filter(
    (command) => command.trim().length > 0,
  ).length
  const totalCount = new Set([
    ...KEYBOARD_ROWS.flat().map((def) => def.key),
    ...NAV_CLUSTER.flat().map((def) => def.key),
    ...ARROW_CLUSTER.flat()
      .filter((def): def is KeyDef => def !== null)
      .map((def) => def.key),
    ...MOUSE_KEYS.map((def) => def.key),
  ]).size

  const capture = (key: string): void => {
    if (!testMode) return
    setCaptured({ key, command: profile.binds[key] })
  }

  const renderKey = (def: KeyDef | null, index: number) => {
    if (!def) {
      return <div key={`spacer-${index}`} style={{ width: `${KEY_UNIT_REM}rem` }} />
    }
    const command = profile.binds[def.key]
    const bound = Boolean(command && command.trim().length > 0)
    const shared = (occurrences.get(def.key) ?? 0) > 1
    return (
      <button
        key={`${def.key}-${index}`}
        type="button"
        title={shared ? `${def.key} (${t('config.overview.legend.shared')})` : def.key}
        onClick={() => capture(def.key)}
        style={{ width: `${(def.units ?? 1) * KEY_UNIT_REM}rem` }}
        className={cn(
          'h-9 shrink-0 rounded-sm border text-[10px] font-medium transition-colors duration-[--dur-fast]',
          bound ? 'border-flame-700 bg-flame-900/30 text-flame-200' : 'border-line text-ink-muted',
          shared && 'ring-1 ring-strogg-500/60 ring-inset',
          testMode ? 'cursor-pointer hover:border-flame-400' : 'cursor-default',
        )}
      >
        {def.label}
      </button>
    )
  }

  const chain = resolveAliasChain(captured?.command)

  return (
    <div className="space-y-4">
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
        <Badge tone="flame">{t('config.overview.legend.bound')}</Badge>
        <Badge tone="neutral">{t('config.overview.legend.free')}</Badge>
        <Badge tone="strogg">{t('config.overview.legend.shared')}</Badge>
      </div>

      {testMode && (
        <Panel className="space-y-2 p-3">
          <p className="text-xs text-ink-muted">{t('config.overview.testMode.hint')}</p>
          {captured && (
            <div className="space-y-1.5 rounded-sm border border-line bg-panel px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="stencil">{captured.key}</span>
                {chain.length === 0 && (
                  <span className="text-xs text-ink-muted">
                    {t('config.overview.testMode.noBind')}
                  </span>
                )}
              </div>
              {chain.length > 0 && (
                <ol className="list-inside list-decimal space-y-0.5">
                  {chain.map((step, index) => (
                    <li key={index} className="text-xs text-ink-dim">
                      <code>{step}</code>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </Panel>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="inline-flex min-w-max flex-col gap-1">
          {KEYBOARD_ROWS.map((keyRow, rowIndex) => (
            <div key={rowIndex} className="flex gap-1">
              {keyRow.map((def, index) => renderKey(def, index))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="space-y-1">
          <SectionLabel>{t('config.overview.navCluster')}</SectionLabel>
          <div className="flex flex-col gap-1">
            {NAV_CLUSTER.map((keyRow, rowIndex) => (
              <div key={rowIndex} className="flex gap-1">
                {keyRow.map((def, index) => renderKey(def, index))}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <SectionLabel>{t('config.overview.arrowCluster')}</SectionLabel>
          <div className="flex flex-col gap-1">
            {ARROW_CLUSTER.map((keyRow, rowIndex) => (
              <div key={rowIndex} className="flex gap-1">
                {keyRow.map((def, index) => renderKey(def, index))}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <SectionLabel>{t('config.overview.mouseCluster')}</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {MOUSE_KEYS.map((def, index) => renderKey(def, index))}
          </div>
        </div>
      </div>
    </div>
  )
}
