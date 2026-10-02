import { useTranslation } from 'react-i18next'
import { ArrowUpCircle, Download } from 'lucide-react'
import { isJobActive, type Job, type LocalizedMessage } from '@shared/types'
import { Button } from '../../../components/ui/Button'
import { ProgressBar } from '../../../components/ui/ProgressBar'
import { engineWithArch } from '../engine-name'
import type { ModTileModel } from '../merge-mod-tiles'

/**
 * The install half of a mod tile / detail panel: the Install button, the running job's progress
 * or waiting reason, its failure, or the installed status with the reasons it cannot be played
 * locally. The same component serves both surfaces so they can never disagree.
 */
export function ModInstallState({
  mod,
  job,
  failure,
  onInstall,
  installTestId,
  onUpdate,
  updateTestId,
  busy = false,
  updateSize = 'sm',
}: {
  mod: ModTileModel
  /** The tile's install job from the jobs store, if there is one. */
  job: Job | null
  /** An install that was refused before it became a job. */
  failure: LocalizedMessage | null
  onInstall: () => void
  installTestId: string
  /** Story 194: starts the update of an installed catalog mod whose catalog version moved on. */
  onUpdate?: () => void
  updateTestId?: string
  /** Another install, remove or update is working on this installation: Update waits. */
  busy?: boolean
  /** The detail panel uses the default 44px button; the dense tile the small one. */
  updateSize?: 'sm' | 'md'
}) {
  const { t } = useTranslation()
  const { local, catalog } = mod
  if (!catalog) return null
  const id = catalog.id

  if (local?.origin === 'catalog') {
    const engine = engineWithArch(local.engineKind, local.arch)
    const updatable = local.status === 'update-available'
    const updating = updatable && job !== null && isJobActive(job)
    const updateError = updatable
      ? job?.status === 'failed'
        ? (job.error ?? null)
        : failure
      : null
    return (
      <div className="w-full space-y-1">
        {updating && job ? (
          <div role="status" data-testid={`mods-tile-progress-${id}`}>
            <ProgressBar
              ratio={job.progress.ratio}
              active={job.status === 'running'}
              label={t(job.labelKey, job.labelParams ?? {})}
            />
          </div>
        ) : updatable ? (
          <p
            className="flex items-center gap-1.5 text-sm text-warning"
            data-testid={`mods-tile-status-${id}`}
          >
            <ArrowUpCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {t('mods.status.updateAvailable')}
          </p>
        ) : (
          <p className="text-sm text-success" data-testid={`mods-tile-status-${id}`}>
            {t(local.contentOnly ? 'mods.status.installedContentOnly' : 'mods.status.installed')}
          </p>
        )}
        {updateError && (
          <p
            role="alert"
            className="text-sm text-danger"
            data-testid={`mods-tile-update-error-${id}`}
          >
            {t(updateError.key, updateError.params ?? {})}
          </p>
        )}
        {updatable && !updating && (
          <Button
            size={updateSize}
            icon={<ArrowUpCircle className="size-3.5" aria-hidden="true" />}
            disabled={busy}
            onClick={onUpdate}
            data-testid={updateTestId}
          >
            {t('mods.action.update')}
          </Button>
        )}
        {local.contentOnly && (
          <p className="text-xs text-warning" data-testid="mods-content-only-reason">
            {t('mods.reason.notPlayableLocally', { engine })}
          </p>
        )}
        {local.pkzUnsupported && (
          <p className="text-xs text-warning" data-testid="mods-pkz-reason">
            {t('mods.reason.pkzNeedsQ2pro', { engine })}
          </p>
        )}
      </div>
    )
  }

  const active = job !== null && isJobActive(job)
  const error = job?.status === 'failed' ? (job.error ?? null) : failure
  return (
    <div className="w-full space-y-2">
      {job && active && job.status === 'waiting' && job.waitingReason && (
        <p role="status" className="text-sm text-warning" data-testid={`mods-tile-status-${id}`}>
          {t(job.waitingReason.key, job.waitingReason.params ?? {})}
        </p>
      )}
      {job && active && job.status !== 'waiting' && (
        <div role="status" data-testid={`mods-tile-progress-${id}`}>
          <ProgressBar
            ratio={job.progress.ratio}
            active={job.status === 'running'}
            label={t(job.labelKey, job.labelParams ?? {})}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger" data-testid={`mods-tile-status-${id}`}>
          {t(error.key, error.params ?? {})}
        </p>
      )}
      {!active && (
        <Button
          size="sm"
          icon={<Download className="size-3.5" aria-hidden="true" />}
          onClick={onInstall}
          data-testid={installTestId}
        >
          {t('mods.action.install')}
        </Button>
      )}
    </div>
  )
}
