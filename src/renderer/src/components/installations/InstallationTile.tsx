import type { Installation } from '@shared/types'
import { cn } from '../../lib/cn'
import { isDemoData } from '../../lib/demo-data'
import { tileCode } from '../../lib/format'
import { useInstallationIcon } from './useInstallationIcon'

/**
 * Where an {@link InstallationTile} is rendered — each site keeps its own size
 * and text treatment, everything else (shape, code text) is shared.
 */
export type InstallationTileSize = 'rail' | 'card' | 'actionBar'

const SIZE_CLASSES: Record<InstallationTileSize, string> = {
  rail: 'aspect-square w-full',
  card: 'size-11',
  actionBar: 'size-12',
}

const TEXT_SIZE_CLASSES: Record<InstallationTileSize, string> = {
  rail: 'text-lg tracking-tight',
  card: 'text-sm',
  actionBar: 'text-base text-flame-300',
}

/**
 * The two-letter engine-code box shown for an installation, in three places
 * (rail, library card, action bar) that used to each inline their own markup.
 *
 * This renders only the inner box — the square and its code text. It does not
 * own the interactive wrapper (button) or any accessible name: callers keep
 * their `aria-label`/`title` exactly where it lives today, on the element that
 * wraps this tile (or, where the original markup had no wrapper at all, on
 * this tile's own root via `className`).
 */
export function InstallationTile({
  installation,
  size,
  className,
  textClassName,
}: {
  installation: Installation | null
  size: InstallationTileSize
  className?: string
  textClassName?: string
}) {
  const iconUrl = useInstallationIcon(installation)
  const demo = installation !== null && isDemoData(installation.checks)
  const failed = installation !== null && Boolean(installation.lastFailure)

  return (
    <div
      className={cn(
        'relative grid place-items-center rounded-md border',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {iconUrl ? (
        // Decorative: the accessible name for this tile lives on the wrapping
        // button/title exactly where it did before an icon existed (story 067
        // D5's AC8) - never on this image.
        <img src={iconUrl} alt="" aria-hidden="true" className="size-full rounded-[inherit] object-cover" />
      ) : (
        <span className={cn('font-display font-semibold', TEXT_SIZE_CLASSES[size], textClassName)}>
          {installation ? tileCode(installation.engineKind, installation.name) : '--'}
        </span>
      )}
      {/* CSS-only microtag (story 074 D7) - text, not colour-only, per /design-tokens. */}
      {demo && (
        <span className="tile-demo-tag" data-testid="installation-tile-demo-tag" aria-hidden="true">
          DEMO
        </span>
      )}
      {/* CSS-only microtag (story 077 D4), mirroring `.tile-demo-tag` - text, not colour-only,
          per /design-tokens. Opposite corner from the demo tag so the two never overlap on the
          rare installation that could carry both. Decorative/aria-hidden: the accessible signal
          lives on `FailureBadge` at each call site, same relationship `.tile-demo-tag` has to
          `DemoBadge`. */}
      {failed && (
        <span className="tile-failed-tag" data-testid="installation-tile-failed-tag" aria-hidden="true">
          FAILED
        </span>
      )}
    </div>
  )
}
