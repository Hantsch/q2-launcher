import { useTranslation } from 'react-i18next'
import type { AltLayerMode } from '@shared/config/alt-layers'
import type { ConfigAction } from '@shared/modules/config'
import { resolveCommandLabel } from '../lib/command-catalog'
import { resolveAliasChain } from '../lib/keyboard-layout'
import type { TestPress } from '../lib/test-mode'

/**
 * Max height of the test-mode readout strip, in rem - about two lines. It
 * never grows past that with the captured chain's length, so pressing a
 * different key while testing doesn't jump the layout around; a longer
 * chain scrolls inside the strip instead.
 *
 * Moved out of `OverviewKeyboardPanel.tsx` along with the strip itself
 * (story 018 D2, decision 23) - the value and the reasoning are unchanged.
 */
export const CAPTURE_MAX_HEIGHT_REM = 3.5

/**
 * The test-mode readout strip: "what does this key do", told honestly per
 * `TestPress` kind instead of the pre-018 code that only ever looked at
 * `profile.binds` (`lib/test-mode.ts`'s header explains why that lied about
 * trigger keys). Presentational only - `OverviewKeyboardPanel.tsx` owns the
 * state machine that produces `press` (story 018 D3).
 *
 * Renders unconditionally (decision 20): outside test mode it shows an
 * inactive hint instead of the press placeholder, so the strip is never a
 * dead invitation to press a key nobody is listening for (decision 21).
 */
export function TestModeReadout({
  press,
  testMode,
  actions,
}: {
  press: TestPress | null
  testMode: boolean
  actions: readonly ConfigAction[]
}) {
  const { t } = useTranslation()

  const modeLabel = (mode: AltLayerMode): string =>
    mode === 'hold'
      ? t('config.overview.testMode.mode.hold')
      : t('config.overview.testMode.mode.toggle')

  const renderChain = (command: string) => {
    const chain = resolveAliasChain(command, actions)
    if (chain.length === 0) {
      return <span className="text-ink-muted">{t('config.overview.testMode.noBind')}</span>
    }
    return chain.map((step, index) => {
      const resolved = resolveCommandLabel(step)
      return (
        <span key={index} className="flex items-center gap-1 text-ink-dim">
          {index > 0 && <span className="text-ink-muted">{'→'}</span>}
          {resolved.recognized ? resolved.label : <code>{step}</code>}
        </span>
      )
    })
  }

  const content = (() => {
    if (!testMode) {
      return <span className="text-ink-muted">{t('config.overview.testMode.inactive')}</span>
    }
    if (!press) {
      return <span className="text-ink-muted">{t('config.overview.testMode.placeholder')}</span>
    }

    if (press.kind === 'unbound') {
      return (
        <>
          <span className="stencil shrink-0">{press.key}</span>
          <span className="text-ink-muted">{t('config.overview.testMode.noBind')}</span>
        </>
      )
    }

    if (press.kind === 'trigger') {
      return (
        <>
          <span className="stencil shrink-0">{press.key}</span>
          <span className="text-ink-dim">
            {t('config.overview.testMode.triggerActivates', {
              name: press.layerName,
              mode: modeLabel(press.mode),
            })}
          </span>
          {press.alias !== null && (
            <span className="flex items-center gap-1 text-ink-dim">
              {t('config.overview.testMode.triggerAlias', { command: press.alias })}
            </span>
          )}
        </>
      )
    }

    // 'override' | 'base'
    const tag =
      press.kind === 'override'
        ? t('config.overview.testMode.sourceLayer', { name: press.layerName })
        : t('config.overview.testMode.sourceBase')
    return (
      <>
        <span className="stencil shrink-0">{press.key}</span>
        <span className="text-ink-muted italic">{tag}</span>
        {renderChain(press.command)}
      </>
    )
  })()

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 overflow-y-auto rounded-sm border border-line bg-panel px-2.5 py-1.5 text-xs"
      style={{ maxHeight: `${CAPTURE_MAX_HEIGHT_REM}rem` }}
    >
      {content}
    </div>
  )
}
