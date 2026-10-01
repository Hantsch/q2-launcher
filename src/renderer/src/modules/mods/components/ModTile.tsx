import { useTranslation } from 'react-i18next'
import type { ModGameDir } from '@shared/modules/mods'
import { Badge } from '../../../components/ui/primitives'
import { cn } from '../../../lib/cn'

/** One game directory of the active installation: its folder name and where it came from. */
export function ModTile({
  mod,
  selected = false,
  onSelect,
}: {
  mod: ModGameDir
  selected?: boolean
  onSelect?: (gameDir: string) => void
}) {
  const { t } = useTranslation()
  const manual = mod.origin === 'manual'
  return (
    <button
      type="button"
      data-testid={`mods-tile-${mod.gameDir}`}
      aria-pressed={selected}
      onClick={() => onSelect?.(mod.gameDir)}
      className={cn(
        'flex min-h-11 min-w-0 flex-col items-start gap-2 rounded-md border bg-panel px-4 py-3 text-left',
        'transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none',
        selected ? 'border-flame-500' : 'border-line',
      )}
    >
      <span className="w-full truncate font-display text-base tracking-[0.06em] text-ink uppercase">
        {mod.gameDir}
      </span>
      <Badge
        tone={manual ? 'neutral' : 'success'}
        testId={manual ? 'mods-tile-origin-manual' : 'mods-tile-origin-catalog'}
      >
        {t(manual ? 'mods.origin.manual' : 'mods.origin.catalog')}
      </Badge>
    </button>
  )
}
