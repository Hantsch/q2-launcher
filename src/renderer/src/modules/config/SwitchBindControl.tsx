import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/primitives'
import { resolveQuakeKeyName } from './lib/keyboard-layout'
import { setSwitchBind } from './client'

/**
 * Story 007 D4: one installation's in-session profile-switch bind. Shown by
 * `InstallationProfilesPanel` only when that installation has 2+ assigned
 * profiles (AC 5) - this component itself does not gate on that, it only
 * renders the control for whichever installation it is given.
 *
 * Press-to-capture mirrors `OverviewKeyboardPanel`'s test-mode listener
 * exactly: a `capturing` flag gates a `window.addEventListener('keydown', ...,
 * true)` that resolves the key via `resolveQuakeKeyName`, ignores anything
 * that does not map to a known Quake II key name, prevents the browser
 * default, and skips key-repeat events. Every mutation (capture, F9
 * suggestion, clear) round-trips through `setSwitchBind` and only calls
 * `onChanged` once the real outcome comes back - no optimistic local state,
 * same discipline as `WriteTargets`/`ProfileAssignmentsPanel`.
 */
export function SwitchBindControl({
  installationId,
  currentKey,
  onChanged,
}: {
  installationId: string
  currentKey: string | undefined
  onChanged: (map: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return
      event.preventDefault()
      if (event.repeat) return
      void applyKey(quakeKey)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [capturing, installationId])

  const applyKey = async (key: string | null): Promise<void> => {
    const result = await setSwitchBind({ installationId, key })
    if (result.ok) {
      onChanged(result.value)
      setCapturing(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="stencil">{t('config.switchBind.label')}</span>

      {capturing ? (
        <Badge tone="warning">{t('config.switchBind.capturing')}</Badge>
      ) : currentKey ? (
        <Badge tone="flame">{currentKey}</Badge>
      ) : (
        <span className="text-xs text-ink-muted">{t('config.switchBind.notSet')}</span>
      )}

      {!capturing && !currentKey && (
        <Button variant="ghost" size="sm" onClick={() => void applyKey('F9')}>
          {t('config.switchBind.suggestF9')}
        </Button>
      )}

      {!capturing && (
        <Button variant="ghost" size="sm" onClick={() => setCapturing(true)}>
          {t('config.switchBind.capture')}
        </Button>
      )}

      {!capturing && currentKey && (
        <Button variant="danger" size="sm" onClick={() => void applyKey(null)}>
          {t('config.switchBind.clear')}
        </Button>
      )}
    </div>
  )
}
