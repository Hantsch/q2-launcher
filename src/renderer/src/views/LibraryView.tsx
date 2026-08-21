import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  FolderPlus,
  HardDriveDownload,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import type { LibraryStats } from '@shared/modules/library'
import { engineLabel, type Installation } from '@shared/types'
import { cn } from '../lib/cn'
import { invoke } from '../lib/bridge'
import { formatDuration, formatRelativeTime, tileCode } from '../lib/format'
import { isPlayable, statusTone } from '../lib/status'
import { useLauncher } from '../store/useLauncher'
import { getLibraryStats } from '../modules/library/client'
import { Button, IconButton } from '../components/ui/Button'
import { Badge, EmptyState, Panel, SectionLabel, StatusDot } from '../components/ui/primitives'
import { ChecksList } from '../components/installations/ChecksList'

/**
 * The library module's view: every installation with its health and the actions
 * that apply to it.
 *
 * Also the proof that the module seam works end to end - the statistics row is
 * fetched over `module:invoke` from the library module's main-process half rather
 * than computed here.
 */
export function LibraryView() {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const openDialog = useLauncher((state) => state.openDialog)
  const validateAll = useLauncher((state) => state.validateAll)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getLibraryStats().then((result) => {
      if (!cancelled && result.ok) setStats(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [installations])

  return (
    <div className="h-full overflow-y-auto scrollbar-gutter-stable">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
              {t('library.title')}
            </h1>
            <p className="text-xs text-ink-muted">
              {t('library.subtitle', { count: installations.length })}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="neutral"
              size="sm"
              icon={<FolderOpen className="size-3.5" />}
              onClick={() => openDialog({ kind: 'add-existing' })}
            >
              {t('library.addExisting')}
            </Button>
            <Button
              variant="neutral"
              size="sm"
              icon={<Search className="size-3.5" />}
              onClick={() => openDialog({ kind: 'detect' })}
            >
              {t('library.autoDetect')}
            </Button>
            <Button
              variant="neutral"
              size="sm"
              icon={<FolderPlus className="size-3.5" />}
              onClick={() => openDialog({ kind: 'create' })}
            >
              {t('library.create')}
            </Button>
            {installations.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />}
                disabled={checking}
                onClick={async () => {
                  setChecking(true)
                  await validateAll()
                  setChecking(false)
                }}
              >
                {t('library.revalidateAll')}
              </Button>
            )}
          </div>
        </header>

        {stats && installations.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label={t('library.stats.total')} value={String(stats.total)} />
            <StatTile label={t('library.stats.ok')} value={String(stats.ok)} tone="text-success" />
            <StatTile
              label={t('library.stats.needsAttention')}
              value={String(stats.needsAttention)}
              tone={stats.needsAttention > 0 ? 'text-warning' : undefined}
            />
            <StatTile
              label={t('library.stats.missing')}
              value={String(stats.missing)}
              tone={stats.missing > 0 ? 'text-danger' : undefined}
            />
            <StatTile
              label={t('library.stats.playtime')}
              value={formatDuration(stats.totalPlaytimeSeconds)}
            />
          </div>
        )}

        {installations.length === 0 ? (
          <Panel className="mt-6">
            <EmptyState
              icon={<HardDriveDownload className="size-6" />}
              title={t('empty.title')}
              body={t('empty.body')}
              hint={t('empty.hint')}
              actions={
                <>
                  <Button
                    variant="primary"
                    icon={<FolderOpen className="size-4" />}
                    onClick={() => openDialog({ kind: 'add-existing' })}
                  >
                    {t('rail.addExisting')}
                  </Button>
                  <Button
                    variant="neutral"
                    icon={<Search className="size-4" />}
                    onClick={() => openDialog({ kind: 'detect' })}
                  >
                    {t('rail.autoDetect')}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<FolderPlus className="size-4" />}
                    onClick={() => openDialog({ kind: 'create' })}
                  >
                    {t('rail.createNew')}
                  </Button>
                </>
              }
            />
          </Panel>
        ) : (
          <ul className="space-y-2.5">
            {installations.map((installation) => (
              <li key={installation.id}>
                <InstallationRow installation={installation} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Panel className="space-y-1 p-3">
      <SectionLabel className="text-[9px]">{label}</SectionLabel>
      <div className={cn('numeric text-xl leading-none text-ink', tone)}>{value}</div>
    </Panel>
  )
}

function InstallationRow({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  const activeId = useLauncher((state) => state.settings.activeInstallationId)
  const setActive = useLauncher((state) => state.setActiveInstallation)
  const play = useLauncher((state) => state.play)
  const validate = useLauncher((state) => state.validateInstallation)
  const update = useLauncher((state) => state.updateInstallation)
  const openDialog = useLauncher((state) => state.openDialog)
  const confirmBeforeRemoving = useLauncher((state) => state.settings.confirmBeforeRemoving)
  const removeInstallation = useLauncher((state) => state.removeInstallation)

  const tone = statusTone(installation.status)
  const active = installation.id === activeId
  const lastPlayed = formatRelativeTime(installation.lastPlayedAt)
  const showChecks = installation.status !== 'ok' && installation.checks.length > 0

  return (
    <Panel
      className={cn(
        'space-y-3 p-4 transition-colors duration-[--dur-base]',
        active && 'border-flame-700',
      )}
    >
      <div className="flex items-start gap-3.5">
        <button
          type="button"
          onClick={() => void setActive(installation.id)}
          title={t('rail.activeMarker')}
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-md border transition-colors duration-[--dur-base]',
            active
              ? 'border-flame-500 bg-flame-900/30 text-flame-200'
              : 'border-line bg-raised text-ink-dim hover:border-line-strong hover:text-ink',
          )}
        >
          <span className="font-display text-sm font-semibold">
            {tileCode(installation.engineKind, installation.name)}
          </span>
        </button>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-sm tracking-[0.08em] text-ink uppercase">
              {installation.name}
            </h2>
            {active && <Badge tone="flame">{t('rail.activeMarker')}</Badge>}
            {installation.favorite && (
              <Star className="size-3 text-flame-500" fill="currentColor" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-muted">
            <span className={cn('flex items-center gap-1.5', tone.text)}>
              <StatusDot className={tone.dot} />
              {t(tone.labelKey)}
            </span>
            <span className="text-ink-faint">/</span>
            <span>{engineLabel(installation.engineKind)}</span>
            <span className="text-ink-faint">/</span>
            <span>{t(`installation.source.${installation.source}`)}</span>
            {installation.gameDirs.length > 0 && (
              <>
                <span className="text-ink-faint">/</span>
                <span>{t('installation.mods', { count: installation.gameDirs.length })}</span>
              </>
            )}
            {lastPlayed && (
              <>
                <span className="text-ink-faint">/</span>
                <span>
                  {t('installation.lastPlayed')}: {lastPlayed}
                </span>
              </>
            )}
          </div>

          {/* `ink-muted` not `ink-faint`: the path is information, and faint is
              documented as decorative-only (2.6:1) in the token file. */}
          <p
            className="numeric truncate text-[11px] text-ink-muted"
            title={installation.rootPath}
            data-selectable
          >
            {installation.rootPath}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={isPlayable(installation.status) ? 'primary' : 'neutral'}
            size="sm"
            disabled={!isPlayable(installation.status)}
            icon={<Play className="size-3.5" />}
            onClick={() => {
              void setActive(installation.id)
              void play(installation.id)
            }}
          >
            {t('installation.action.play')}
          </Button>

          <IconButton
            label={
              installation.favorite
                ? t('installation.action.unfavorite')
                : t('installation.action.favorite')
            }
            size="sm"
            onClick={() => void update({ id: installation.id, favorite: !installation.favorite })}
          >
            <Star
              className={cn('size-3.5', installation.favorite && 'text-flame-500')}
              {...(installation.favorite ? { fill: 'currentColor' } : {})}
            />
          </IconButton>

          <IconButton
            label={t('installation.action.reveal')}
            size="sm"
            onClick={() => void invoke('app:revealPath', installation.rootPath)}
          >
            <FolderOpen className="size-3.5" />
          </IconButton>

          <IconButton
            label={t('installation.action.revalidate')}
            size="sm"
            onClick={() => void validate(installation.id)}
          >
            <RefreshCw className="size-3.5" />
          </IconButton>

          <IconButton
            label={t('installation.action.rename')}
            size="sm"
            onClick={() => openDialog({ kind: 'rename', installationId: installation.id })}
          >
            <Pencil className="size-3.5" />
          </IconButton>

          {/* Destructive action kept visually apart from the routine ones. */}
          <div className="mx-1 h-5 w-px bg-line" />

          <IconButton
            label={t('installation.action.remove')}
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirmBeforeRemoving) {
                openDialog({ kind: 'remove', installationId: installation.id })
              } else {
                void removeInstallation(installation.id)
              }
            }}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>

      {showChecks && (
        <div className="border-t border-line pt-3">
          <ChecksList installation={installation} />
        </div>
      )}
    </Panel>
  )
}
