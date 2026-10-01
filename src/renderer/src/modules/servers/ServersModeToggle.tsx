import { useTranslation } from 'react-i18next'
import type { ServersBrowseMode } from '@shared/modules/servers'
import { Button } from '../../components/ui/Button'

const MODES: readonly ServersBrowseMode[] = ['online', 'lan']

/** Story 196 D4: Online / LAN segmented switch for the server browser (mirrors `LayerSwitcher`). */
export function ServersModeToggle({
  mode,
  onChange,
}: {
  mode: ServersBrowseMode
  onChange: (mode: ServersBrowseMode) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('servers.mode.label')}
      className="flex flex-wrap items-center gap-1.5"
    >
      {MODES.map((m) => (
        <Button
          key={m}
          variant={mode === m ? 'primary' : 'neutral'}
          size="sm"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          data-testid={`servers-mode-${m}`}
        >
          {t(`servers.mode.${m}`)}
        </Button>
      ))}
    </div>
  )
}
