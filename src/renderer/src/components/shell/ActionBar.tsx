import { useTranslation } from 'react-i18next'
import { Play, Wrench, X } from 'lucide-react'
import { engineLabel, type Installation, type Job, type LaunchState } from '@shared/types'
import { cn } from '../../lib/cn'
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatSpeed,
  shortenPath,
  tileCode,
} from '../../lib/format'
import { isPlayable, statusTone } from '../../lib/status'
import { useActiveInstallation, useActiveJob, useLauncher } from '../../store/useLauncher'
import { IconButton, PlayButton } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'
import { Select } from '../ui/controls'
import { StatusDot } from '../ui/primitives'
import { useFixAction } from '../installations/ChecksList'

/**
 * The bottom action bar: who is selected, what is happening, and the one button
 * that starts the game.
 *
 * Modelled on the Guild Wars 2 launcher's footer, including the byte/speed/files
 * readout and the PLAYABLE tick that marks the point where a download has
 * fetched enough to start playing.
 */
export function ActionBar() {
  const { t } = useTranslation()
  const installation = useActiveInstallation()
  const job = useActiveJob(installation?.id ?? null)
  const launch = useLauncher((state) => state.launch)
  const appVersion = useLauncher((state) => state.appInfo?.appVersion)
  const play = useLauncher((state) => state.play)
  const cancelJob = useLauncher((state) => state.cancelJob)
  const updateInstallation = useLauncher((state) => state.updateInstallation)
  const setRoute = useLauncher((state) => state.setRoute)
  const runFix = useFixAction()

  const action = resolvePrimaryAction(installation, job, launch)

  const onPrimary = (): void => {
    if (!installation) return
    switch (action.kind) {
      case 'play':
        void play(installation.id)
        return
      case 'locate':
        void runFix(installation, 'locate-root')
        return
      case 'repair':
        setRoute('/downloads')
        return
      case 'busy':
        return
    }
  }

  return (
    <footer
      className="panel edge-flame rivets relative z-20 flex shrink-0 items-center gap-6 rounded-none border-x-0 border-b-0 px-5"
      style={{ height: 'var(--actionbar-h)' }}
    >
      {/* --- who --- */}
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <div
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-md border',
            installation ? 'border-flame-700 bg-flame-900/25' : 'border-line bg-raised',
          )}
        >
          <span className="font-display text-base font-semibold text-flame-300">
            {installation ? tileCode(installation.engineKind, installation.name) : '--'}
          </span>
        </div>

        <div className="min-w-0 space-y-1">
          <div className="truncate font-display text-sm tracking-[0.08em] text-ink uppercase">
            {installation?.name ?? t('actionbar.noInstallation')}
          </div>

          {installation ? (
            <>
              <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                <StatusDot className={statusTone(installation.status).dot} />
                <span className={statusTone(installation.status).text}>
                  {t(statusTone(installation.status).labelKey)}
                </span>
                <span className="text-ink-faint">/</span>
                <span>{engineLabel(installation.engineKind)}</span>
                <span className="text-ink-faint">/</span>
                <span className="numeric truncate" title={installation.rootPath}>
                  {shortenPath(installation.rootPath, 34)}
                </span>
              </div>

              <GameDirSelect
                installation={installation}
                onChange={(activeGameDir) =>
                  void updateInstallation({ id: installation.id, activeGameDir })
                }
              />
            </>
          ) : (
            <p className="text-[11px] text-ink-muted">{t('empty.body')}</p>
          )}
        </div>
      </div>

      {/* --- what is happening --- */}
      <div className="hidden min-w-0 flex-1 flex-col gap-1.5 lg:flex">
        {job ? (
          <JobReadout job={job} onCancel={() => void cancelJob(job.id)} />
        ) : (
          <LaunchReadout launch={launch} installation={installation} />
        )}
      </div>

      {/* --- the button --- */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <PlayButton
          tone={action.tone}
          disabled={action.disabled}
          onClick={onPrimary}
          icon={
            action.kind === 'repair' ? (
              <Wrench className="size-4" />
            ) : (
              <Play className="size-4" fill="currentColor" />
            )
          }
        >
          {t(action.labelKey)}
        </PlayButton>
        {appVersion && (
          <span className="stencil text-[9px] tracking-[0.2em]">
            {t('actionbar.buildLabel', { version: appVersion })}
          </span>
        )}
      </div>
    </footer>
  )
}

function GameDirSelect({
  installation,
  onChange,
}: {
  installation: Installation
  onChange: (gameDir: string) => void
}) {
  const { t } = useTranslation()
  const mods = installation.gameDirs.filter((dir) => dir.toLowerCase() !== 'baseq2')
  if (mods.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <span className="stencil text-[9px]">{t('dialog.gameDir.label')}</span>
      <Select
        className="h-6 w-44 py-0 text-xs"
        value={installation.activeGameDir}
        onChange={(event) => onChange(event.target.value)}
        options={[
          { value: '', label: t('dialog.gameDir.base') },
          ...mods.map((dir) => ({ value: dir, label: dir })),
        ]}
      />
    </div>
  )
}

/** The Guild Wars 2 style download readout. */
function JobReadout({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const { t } = useTranslation()
  const { ratio, bytesDone, bytesTotal, bytesPerSecond, filesRemaining, etaSeconds } = job.progress

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div className="numeric flex items-baseline gap-3 text-[11px] tracking-wide text-ink-dim uppercase">
          {ratio !== null && <span className="text-flame-300">{formatPercent(ratio)}</span>}
          <span>
            {t('actionbar.downloading', {
              done: bytesTotal
                ? `${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)}`
                : formatBytes(bytesDone),
            })}
          </span>
          {bytesPerSecond !== undefined && <span>{formatSpeed(bytesPerSecond)}</span>}
          {filesRemaining !== undefined && (
            <span className="hidden xl:inline">
              {t('actionbar.filesRemaining', { count: filesRemaining })}
            </span>
          )}
        </div>

        {job.cancellable && (
          <IconButton label={t('actionbar.cancelJob')} size="sm" onClick={onCancel}>
            <X className="size-3.5" />
          </IconButton>
        )}
      </div>

      <ProgressBar
        ratio={ratio}
        active={job.status === 'running'}
        label={t(job.labelKey, job.labelParams ?? {})}
        {...(job.playableAtRatio !== undefined ? { playableAtRatio: job.playableAtRatio } : {})}
      />

      <div className="flex items-center justify-between gap-3 text-[10px]">
        {job.playableAtRatio !== undefined ? (
          <span
            className="stencil flex items-center gap-1 text-strogg-500"
            style={{ marginLeft: `${job.playableAtRatio * 100}%` }}
          >
            <span aria-hidden>&#9650;</span>
            {t('actionbar.playable')}
          </span>
        ) : (
          <span />
        )}
        {etaSeconds !== undefined && (
          <span className="numeric text-ink-muted">
            {t('actionbar.eta', { time: formatDuration(etaSeconds) })}
          </span>
        )}
      </div>
    </>
  )
}

/** What the middle column shows when nothing is downloading. */
function LaunchReadout({
  launch,
  installation,
}: {
  launch: LaunchState
  installation: Installation | null
}) {
  const { t } = useTranslation()

  if (installation && launch.installationId === installation.id) {
    if (launch.phase === 'running' || launch.phase === 'starting') {
      return (
        <div className="flex items-center gap-2 text-xs text-strogg-300">
          <StatusDot className="bg-strogg-500" pulse />
          {t('actionbar.running')}
          {launch.pid !== undefined && (
            <span className="numeric text-ink-muted">pid {launch.pid}</span>
          )}
        </div>
      )
    }
    if (launch.phase === 'exited') {
      return <p className="text-xs text-ink-muted">{t('actionbar.exited')}</p>
    }
  }

  if (!installation) return null

  // Idle: name what the middle column is showing instead of leaving a bare,
  // unlabelled path floating in the middle of the bar.
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="stencil text-[9px]">{t('installation.engine')}</div>
      <p
        className="numeric truncate text-[11px] text-ink-muted"
        title={installation.executablePath ?? ''}
      >
        {installation.executablePath
          ? shortenPath(installation.executablePath, 56)
          : t('validation.noExecutable')}
      </p>
    </div>
  )
}

type PrimaryActionKind = 'play' | 'locate' | 'repair' | 'busy'

interface PrimaryAction {
  kind: PrimaryActionKind
  labelKey: string
  tone: 'flame' | 'neutral' | 'danger'
  disabled: boolean
}

/**
 * One place decides what the big button does, so it can never disagree with the
 * state shown next to it. The shape stays constant; only label, colour and
 * enabled-ness change.
 */
function resolvePrimaryAction(
  installation: Installation | null,
  job: Job | null,
  launch: LaunchState,
): PrimaryAction {
  if (!installation) {
    return { kind: 'busy', labelKey: 'installation.action.play', tone: 'flame', disabled: true }
  }

  const running =
    launch.installationId === installation.id &&
    (launch.phase === 'running' || launch.phase === 'starting')
  if (running) {
    return {
      kind: 'busy',
      labelKey: 'installation.action.running',
      tone: 'neutral',
      disabled: true,
    }
  }

  if (job) {
    // Past the PLAYABLE mark the user may start while the rest downloads.
    const playableNow =
      job.playableAtRatio !== undefined &&
      job.progress.ratio !== null &&
      job.progress.ratio >= job.playableAtRatio
    if (!playableNow) {
      return {
        kind: 'busy',
        labelKey: 'installation.action.install',
        tone: 'neutral',
        disabled: true,
      }
    }
  }

  if (installation.status === 'missing') {
    return {
      kind: 'locate',
      labelKey: 'installation.action.locate',
      tone: 'neutral',
      disabled: false,
    }
  }

  if (!isPlayable(installation.status)) {
    return {
      kind: 'repair',
      labelKey: 'installation.action.repair',
      tone: 'neutral',
      disabled: false,
    }
  }

  return { kind: 'play', labelKey: 'installation.action.play', tone: 'flame', disabled: false }
}
