import { useTranslation } from 'react-i18next'
import type { AltLayer } from '@shared/config/alt-layers'
import { cn } from '../../../lib/cn'
import { Button } from '../../../components/ui/Button'

/**
 * Base/alt-layer segmented switcher, lifted out of `LayersPanel` (story
 * 013 D2) into a standalone control so the keyboard overview's header can
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
      <div
        role="group"
        aria-label={t('config.layersPanel.selector.label')}
        className="flex flex-wrap items-center gap-1.5"
      >
        <Button
          variant={activeLayerId === null ? 'primary' : 'neutral'}
          size="sm"
          aria-pressed={activeLayerId === null}
          onClick={() => onSelect(null)}
        >
          {t('config.layersPanel.selector.base')}
        </Button>
        {layers.map((layer) => (
          <Button
            key={layer.id}
            variant={activeLayerId === layer.id ? 'primary' : 'neutral'}
            size="sm"
            aria-pressed={activeLayerId === layer.id}
            onClick={() => onSelect(layer.id)}
          >
            {layer.name}
          </Button>
        ))}
      </div>
    </div>
  )
}
