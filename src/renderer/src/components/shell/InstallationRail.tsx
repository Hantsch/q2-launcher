import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, FolderPlus, LayoutGrid, Play, Plus, Search } from 'lucide-react'
import { engineLabel, type Installation } from '@shared/types'
import { cn } from '../../lib/cn'
import { shortenPath, tileCode } from '../../lib/format'
import { isPlayable, statusTone } from '../../lib/status'
import { useLauncher } from '../../store/useLauncher'
import { Badge, SectionLabel, StatusDot } from '../ui/primitives'
import { Button, IconButton } from '../ui/Button'
import { HoverCard } from '../ui/HoverCard'
import { Menu, type MenuItem } from '../ui/Menu'

/**
 * The vertical installation strip - this launcher's answer to the Battle.net
 * favourites bar.
 *
 * Vertical rather than horizontal on purpose: a horizontal strip runs out of
 * room at about eight entries, and people who play Quake II tend to keep one
 * install per mod. Vertically it just scrolls.
 *
 * Each tile carries four independent signals without any text: which install is
 * active (amber frame + rail marker), its health (status dot), whether it is
 * running (pulsing dot), and whether it is a favourite (amber corner).
 */
export function InstallationRail() {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const activeId = useLauncher((state) => state.settings.activeInstallationId)
  const setActive = useLauncher((state) => state.setActiveInstallation)
  const reorder = useLauncher((state) => state.reorderInstallations)
  const openDialog = useLauncher((state) => state.openDialog)
  const setRoute = useLauncher((state) => state.setRoute)

  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const addItems: MenuItem[] = [
    {
      id: 'add-existing',
      label: t('rail.addExisting'),
      icon: <FolderOpen className="size-4" />,
      onSelect: () => openDialog({ kind: 'add-existing' }),
    },
    {
      id: 'detect',
      label: t('rail.autoDetect'),
      icon: <Search className="size-4" />,
      onSelect: () => openDialog({ kind: 'detect' }),
    },
    {
      id: 'create',
      label: t('rail.createNew'),
      icon: <FolderPlus className="size-4" />,
      onSelect: () => openDialog({ kind: 'create' }),
    },
  ]

  const commitReorder = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const ids = installations.map((installation) => installation.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    void reorder(ids)
  }

  /** Ctrl/Cmd + arrow moves a tile, so ordering works without a mouse. */
  const moveWithKeyboard = (id: string, direction: -1 | 1): void => {
    const ids = installations.map((installation) => installation.id)
    const from = ids.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ids.length) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    void reorder(ids)
  }

  return (
    <aside
      className="flex shrink-0 flex-col items-center gap-3 border-r border-line bg-panel/55 py-3"
      style={{ width: 'var(--rail-w)' }}
      aria-label={t('rail.label')}
    >
      <SectionLabel className="text-[9px] tracking-[0.22em]">{t('rail.label')}</SectionLabel>

      <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2">
        {installations.map((installation) => (
          <li key={installation.id} className="w-full">
            <HoverCard content={<RailCard installation={installation} />}>
              <RailTile
                installation={installation}
                active={installation.id === activeId}
                dropTarget={overId === installation.id && dragId !== installation.id}
                onSelect={() => void setActive(installation.id)}
                onDragStart={() => setDragId(installation.id)}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
                onDragOver={() => setOverId(installation.id)}
                onDrop={() => {
                  commitReorder(installation.id)
                  setDragId(null)
                  setOverId(null)
                }}
                onMove={(direction) => moveWithKeyboard(installation.id, direction)}
              />
            </HoverCard>
          </li>
        ))}

        <li className="w-full">
          <Menu items={addItems} label={t('rail.add')}>
            {({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label={t('rail.add')}
                title={t('rail.add')}
                aria-expanded={open}
                className={cn(
                  'grid aspect-square w-full place-items-center rounded-md border border-dashed',
                  'transition-colors duration-[--dur-fast]',
                  open
                    ? 'border-flame-600 bg-flame-900/30 text-flame-300'
                    : 'border-line-strong text-ink-muted hover:border-flame-700 hover:bg-hover hover:text-flame-300',
                )}
              >
                <Plus className="size-5" />
              </button>
            )}
          </Menu>
        </li>
      </ul>

      {/* Separated from the list so it does not read as another installation. */}
      <div className="w-full shrink-0 px-3 pt-1">
        <div className="h-px w-full bg-line" />
      </div>
      <IconButton
        label={t('rail.manage')}
        onClick={() => setRoute('/library')}
        className="shrink-0"
      >
        <LayoutGrid className="size-4" />
      </IconButton>
    </aside>
  )
}

function RailTile({
  installation,
  active,
  dropTarget,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
}: {
  installation: Installation
  active: boolean
  dropTarget: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDrop: () => void
  onMove: (direction: -1 | 1) => void
}) {
  const { t } = useTranslation()
  const running = useLauncher(
    (state) =>
      state.launch.installationId === installation.id &&
      (state.launch.phase === 'running' || state.launch.phase === 'starting'),
  )
  const tone = statusTone(installation.status)

  return (
    <button
      type="button"
      draggable
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey)) return
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          onMove(-1)
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          onMove(1)
        }
      }}
      aria-current={active ? 'true' : undefined}
      aria-label={installation.name}
      className={cn(
        'group relative grid aspect-square w-full place-items-center rounded-md border',
        'transition-[border-color,box-shadow,background-color] duration-[--dur-base] ease-[--ease-out-quart]',
        active
          ? 'border-flame-500 bg-flame-900/25 shadow-[var(--shadow-flame)]'
          : 'border-line bg-raised hover:border-line-strong hover:bg-hover',
        dropTarget && 'border-strogg-500',
      )}
    >
      {/* Active marker, bleeding into the rail edge like a plugged-in cartridge. */}
      {active && (
        <span className="absolute top-1/2 -left-[9px] h-7 w-[3px] -translate-y-1/2 rounded-r-sm bg-flame-500 shadow-[0_0_10px_rgb(255_138_31/0.8)]" />
      )}

      <span
        className={cn(
          'font-display text-lg font-semibold tracking-tight',
          active ? 'text-flame-200' : 'text-ink-dim group-hover:text-ink',
        )}
      >
        {tileCode(installation.engineKind, installation.name)}
      </span>

      <span className="absolute top-1.5 right-1.5">
        <StatusDot className={running ? 'bg-strogg-500' : tone.dot} pulse={running} />
      </span>

      {installation.favorite && (
        <span
          className="absolute bottom-0 left-0 size-0 border-r-8 border-b-8 border-r-transparent border-b-flame-500"
          title={t('installation.action.unfavorite')}
        />
      )}
    </button>
  )
}

/** Hover card body: everything you need to pick between two installs. */
function RailCard({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  const play = useLauncher((state) => state.play)
  const setActive = useLauncher((state) => state.setActiveInstallation)
  const tone = statusTone(installation.status)
  const playable = isPlayable(installation.status)

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <div className="truncate font-display text-sm tracking-wide text-ink uppercase">
          {installation.name}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={installation.engineKind === 'r1q2' ? 'flame' : 'neutral'}>
            {engineLabel(installation.engineKind)}
          </Badge>
          {installation.detectedVersion && (
            <Badge tone="neutral">{installation.detectedVersion}</Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <StatusDot className={tone.dot} />
        <span className={cn('text-xs', tone.text)}>{t(tone.labelKey)}</span>
      </div>

      <p className="numeric truncate text-[11px] text-ink-muted" title={installation.rootPath}>
        {shortenPath(installation.rootPath, 40)}
      </p>

      {installation.gameDirs.length > 0 && (
        <p className="text-[11px] text-ink-muted">
          {t('installation.mods', { count: installation.gameDirs.length })}
        </p>
      )}

      <Button
        variant={playable ? 'primary' : 'neutral'}
        size="sm"
        fullWidth
        disabled={!playable}
        icon={<Play className="size-3.5" />}
        onClick={() => {
          void setActive(installation.id)
          void play(installation.id)
        }}
      >
        {t('rail.quickPlay')}
      </Button>
    </div>
  )
}
