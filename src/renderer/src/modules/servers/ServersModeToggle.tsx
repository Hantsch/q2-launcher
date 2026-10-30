import { useTranslation } from 'react-i18next'
import type { ServersBrowseMode } from '@shared/modules/servers'
import { SegmentedControl } from '../../components/ui/SegmentedControl'

const MODES: readonly ServersBrowseMode[] = ['online', 'lan']

/** Story 196: Online / LAN segmented switch for the server browser (mirrors `LayerSwitcher`). */
export function ServersModeToggle({
  mode,
  onChange,
}: {
  mode: ServersBrowseMode
  onChange: (mode: ServersBrowseMode) => void
}) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      label={t('servers.mode.label')}
      options={MODES.map((m) => ({
        value: m,
        label: t(`servers.mode.${m}`),
        testId: `servers-mode-${m}`,
      }))}
      value={mode}
      onChange={onChange}
    />
  )
}
