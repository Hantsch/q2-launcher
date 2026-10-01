import { useTranslation } from 'react-i18next'
import type { Job, LocalizedMessage } from '@shared/types'
import { cn } from '../../../lib/cn'
import type { ModTileModel } from '../merge-mod-tiles'
import { ModInstallState } from './ModInstallState'

/**
 * One mod: a catalog entry (name + description, plain text), a game directory of the active
 * installation, or both for one gamedir. Every tile can be selected.
 */
export function ModTile({
  mod,
  selected = false,
  onSelect,
  job = null,
  failure = null,
  onInstall,
  onUpdate,
  busy = false,
}: {
  mod: ModTileModel
  selected?: boolean
  onSelect?: (gameDir: string) => void
  /** The tile's install job from the jobs store. */
  job?: Job | null
  /** An install that was refused before it became a job. */
  failure?: LocalizedMessage | null
  /** Starts the install; the tile never picks a version. */
  onInstall?: (catalogId: string) => void
  /** Starts the update of an installed catalog mod (the view asks what it would touch first). */
  onUpdate?: (catalogId: string) => void
  /** Another install, remove or update is working on this installation. */
  busy?: boolean
}) {
  const { t } = useTranslation()
  const local = mod.local
  const manual = local?.origin === 'manual'
  const body = (
    <>
      {/* Decorative banner: the gamedir as a stencilled watermark, CSS only. */}
      <span className="mod-card-banner block h-20 w-full shrink-0">
        <span className="mod-card-watermark" aria-hidden="true">
          {mod.gameDir}
        </span>
      </span>
      <span className="flex w-full flex-1 flex-col gap-2 px-5 pt-4 pb-5">
        <span className="w-full truncate font-display text-lg tracking-[0.06em] text-ink uppercase">
          {mod.name ?? mod.gameDir}
        </span>
        <span className="numeric w-full truncate text-xs text-ink-muted">{mod.gameDir}/</span>
        {mod.description && (
          <span
            className="line-clamp-4 w-full text-sm leading-relaxed text-ink-dim"
            data-testid="mods-tile-description"
          >
            {mod.description}
          </span>
        )}
      </span>
    </>
  )
  return (
    <article
      className={cn(
        'panel group flex h-full min-w-0 flex-col overflow-hidden rounded-lg',
        'transition-[border-color,box-shadow] duration-[--dur-base] ease-[--ease-out-quart]',
        selected
          ? 'edge-flame border-flame-500 shadow-[var(--shadow-flame)]'
          : 'hover:border-line-strong',
      )}
      data-selected={selected || undefined}
    >
      <button
        type="button"
        data-testid={`mods-tile-${mod.gameDir}`}
        aria-pressed={selected}
        onClick={() => onSelect?.(mod.gameDir)}
        className="flex min-h-11 w-full flex-1 flex-col items-start text-left focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none focus-visible:ring-inset"
      >
        {body}
      </button>
      {(mod.catalog || manual) && (
        <div className="space-y-2 border-t border-line bg-base/50 px-5 py-3">
          {manual && (
            <p className="text-sm text-ink-dim" data-testid="mods-tile-origin-manual">
              {t('mods.origin.manual')}
            </p>
          )}
          {mod.catalog && (
            <ModInstallState
              mod={mod}
              job={job}
              failure={failure}
              onInstall={() => onInstall?.(mod.catalog!.id)}
              installTestId={`mods-install-${mod.catalog.id}`}
              onUpdate={() => onUpdate?.(mod.catalog!.id)}
              updateTestId={`mods-update-${mod.catalog.id}`}
              busy={busy}
            />
          )}
        </div>
      )}
    </article>
  )
}
