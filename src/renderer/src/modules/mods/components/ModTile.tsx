import { useTranslation } from 'react-i18next'
import { Badge } from '../../../components/ui/primitives'
import { cn } from '../../../lib/cn'
import type { ModTileModel } from '../merge-mod-tiles'

/**
 * One mod: a catalog entry (name + description, plain text), a game directory of the active
 * installation, or both for one gamedir. Every tile can be selected.
 */
export function ModTile({
  mod,
  selected = false,
  onSelect,
}: {
  mod: ModTileModel
  selected?: boolean
  onSelect?: (gameDir: string) => void
}) {
  const { t } = useTranslation()
  const local = mod.local
  const manual = local?.origin === 'manual'
  const className = cn(
    'flex min-h-11 min-w-0 flex-col items-start gap-2 rounded-md border bg-panel px-4 py-3 text-left',
    selected ? 'border-flame-500' : 'border-line',
  )
  const body = (
    <>
      <span className="w-full truncate font-display text-base tracking-[0.06em] text-ink uppercase">
        {mod.name ?? mod.gameDir}
      </span>
      {mod.description && (
        <span className="w-full text-sm text-ink-dim" data-testid="mods-tile-description">
          {mod.description}
        </span>
      )}
      {local && (
        <Badge
          tone={manual ? 'neutral' : 'success'}
          testId={manual ? 'mods-tile-origin-manual' : 'mods-tile-origin-catalog'}
        >
          {t(manual ? 'mods.origin.manual' : 'mods.origin.catalog')}
        </Badge>
      )}
    </>
  )
  return (
    <button
      type="button"
      data-testid={`mods-tile-${mod.gameDir}`}
      aria-pressed={selected}
      onClick={() => onSelect?.(mod.gameDir)}
      className={cn(
        className,
        'transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none',
      )}
    >
      {body}
    </button>
  )
}
