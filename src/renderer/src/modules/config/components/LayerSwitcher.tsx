import { useTranslation } from 'react-i18next'
import type { AltLayer } from '@shared/config/aliases/alt-layers'
import { cn } from '../../../lib/cn'
import { SegmentedControl } from '../../../components/ui/SegmentedControl'

/** Option value for the base layer; layer ids are never empty. */
const BASE = ''

/**
 * Base/alt-layer segmented switcher, lifted out of `LayersPanel` (story
 * 013) into a standalone control so the keyboard overview's header can
 * host it directly instead of the layer-management panel below the board.
 * Renders nothing when there are no layers - same "nothing to switch"
 * behavior the inline block had.
 */
export function LayerSwitcher({
  layers,
  activeLayerId,
  onSelect,
  className,
}: {
  layers: readonly AltLayer[]
  activeLayerId: string | null
  onSelect: (layerId: string | null) => void
  className?: string
}) {
  const { t } = useTranslation()

  if (layers.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-xs text-ink-muted">{t('config.layersPanel.selector.label')}</span>
      <SegmentedControl
        label={t('config.layersPanel.selector.label')}
        options={[
          { value: BASE, label: t('config.layersPanel.selector.base') },
          ...layers.map((layer) => ({ value: layer.id, label: layer.name })),
        ]}
        value={activeLayerId ?? BASE}
        onChange={(id) => onSelect(id === BASE ? null : id)}
      />
    </div>
  )
}
