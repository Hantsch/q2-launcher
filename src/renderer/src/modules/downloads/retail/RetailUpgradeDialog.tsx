import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { DetectedRetailSource } from '@shared/modules/downloads'
import { formatBytes } from '../../../lib/format'
import { useModuleQuery } from '../../../lib/useModuleQuery'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { getDetectedRetailSources, startRetailUpgrade } from '../client'
import { useStartJob } from '../../../components/jobs/useStartJob'
import { JobActionDialog } from '../components/JobActionDialog'

/**
 * Story 090: the retail-upgrade dialog - lets a demo installation import `pak0.pak`/`pak1.pak`
 * from a detected Steam/GOG/Epic source (`[[088]]`'s `bootstrap.retailSources`), turning it into a
 * normal, non-demo installation once the `retail.upgradeStart` job finishes. Opened via
 * `openDialog({ kind: 'module', moduleId: 'downloads', view: 'retail-upgrade', installationId })` -
 * the trigger buttons live elsewhere; this component only needs to render correctly
 * once reached.
 *
 * Mirrors `BootstrapWizard`'s dialog shape: fetch-on-mount into `useState`, a `Modal` with a
 * footer-driven primary action, and a "start -> switch to `RunningStep`" transition once the job
 * exists (same convention as the wizard's own `'confirm' -> 'running'` step, reusing `RunningStep`
 * itself rather than a second progress view). Unlike the wizard, there is only one screen before
 * that transition - no multi-step state machine is warranted for a single picker.
 *
 * The source list itself mirrors `GameDataStep`'s `store-copy` rendering (row shape, verified vs.
 * unverified-with-reason, the same `SIZE_MISMATCH_REASON_TO_PAK` interpolation) rather than
 * importing it - `GameDataStep`'s rendering is inline in that component, not an extractable piece,
 * and this dialog's `data-testid`s are deliberately its own (the e2e flow relies on them):
 * `retail-upgrade-dialog` (the picker's container), `retail-upgrade-source-list`,
 * `retail-upgrade-source-item` (one per row, `data-source-path` naming which), `-unverified` (the
 * rejection reason, present only on an unverified row), `retail-upgrade-no-sources` (the
 * empty state, no picker rendered alongside it), `retail-upgrade-confirm`.
 *
 * The "only a verified source is selectable" rule: an unverified row's button is `disabled` and
 * shows `inspection.unverifiedReason` underneath instead - the same UX `GameDataStep` already uses
 * for the wizard's own copy step, per refine's Decisions ("mirror whatever 088 already does here
 * exactly, don't invent new UX"). The confirm button additionally requires a verified selection,
 * so main's own `downloads.error.retailSourceUnverified` refusal is a defence-in-depth backstop, not
 * something this dialog relies on for its primary gate.
 */
const SIZE_MISMATCH_REASON_TO_PAK = {
  'bootstrap.retailSource.pak0SizeMismatch': 'pak0',
  'bootstrap.retailSource.pak1SizeMismatch': 'pak1',
} as const

export function RetailUpgradeDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)

  const sourcesQuery = useModuleQuery(getDetectedRetailSources)
  const sources = sourcesQuery.data ?? (sourcesQuery.state === 'error' ? [] : null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const { start, starting, refusal, jobId, job } = useStartJob(startRetailUpgrade)
  const startError = refusal ? t(refusal.key, refusal.params ?? {}) : null

  // Zero-click convenience, same default-selection convention as `BootstrapWizard`'s
  // `selectDataSource`: pick the first verified source so a single-source case needs no click
  // at all, but never overwrite a choice the user already made.
  useEffect(() => {
    const firstVerified = sourcesQuery.data?.find((candidate) => candidate.inspection.verified)
    if (firstVerified) setSelectedPath((chosen) => chosen ?? firstVerified.rootPath)
  }, [sourcesQuery.data])

  const selectedSource = sources?.find((candidate) => candidate.rootPath === selectedPath)
  const canConfirm = !!selectedSource?.inspection.verified && !starting

  function confirm(): void {
    if (!selectedSource?.inspection.verified) return
    void start({ installationId, sourceRootPath: selectedSource.rootPath })
  }

  return (
    <JobActionDialog
      title={t('retailUpgrade.title')}
      description={t('retailUpgrade.description')}
      onClose={closeDialog}
      starting={starting}
      jobId={jobId}
      job={job}
      dismissTestId="retail-upgrade-dismiss"
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog} disabled={starting}>
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!canConfirm}
            onClick={confirm}
            data-testid="retail-upgrade-confirm"
          >
            {t('retailUpgrade.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="retail-upgrade-dialog">
        {sources === null && <p className="text-xs text-ink-muted">{t('retailUpgrade.loading')}</p>}

        {sources !== null && sources.length === 0 && (
          <p className="text-xs text-ink-muted" data-testid="retail-upgrade-no-sources">
            {t('retailUpgrade.noSources')}
          </p>
        )}

        {sources !== null && sources.length > 0 && (
          <div className="space-y-2" data-testid="retail-upgrade-source-list">
            {sources.map((source, index) => {
              const verified = source.inspection.verified
              const isSelected = selectedPath === source.rootPath
              return (
                <div key={source.rootPath} className="space-y-1">
                  <button
                    type="button"
                    disabled={!verified}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedPath(source.rootPath)}
                    data-testid="retail-upgrade-source-item"
                    data-source-path={source.rootPath}
                    data-index={index}
                    className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-colors ${
                      !verified
                        ? 'cursor-not-allowed border-line-strong bg-void/10 opacity-60'
                        : isSelected
                          ? 'border-flame-600 bg-void/40'
                          : 'border-line-strong bg-void/10 hover:bg-void/25'
                    }`}
                  >
                    <span
                      className={`grid size-6 shrink-0 place-items-center rounded-full ${
                        isSelected ? 'bg-flame-500 text-flame-ink' : 'bg-transparent'
                      }`}
                    >
                      {isSelected && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-sm tracking-[0.04em] text-ink uppercase">
                        {t(`bootstrapWizard.gameData.store.${source.source}`)}
                      </p>
                      <p className="truncate text-xs text-ink-muted" title={source.rootPath}>
                        {source.rootPath}
                      </p>
                    </div>
                  </button>
                  {!verified && source.inspection.unverifiedReason && (
                    <p
                      className="pl-3 text-xs text-danger"
                      data-testid="retail-upgrade-source-item-unverified"
                    >
                      {t(
                        source.inspection.unverifiedReason,
                        sizeMismatchParams(source.inspection, source.inspection.unverifiedReason),
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {startError && (
          <p className="text-xs text-danger" data-testid="retail-upgrade-error">
            {startError}
          </p>
        )}
      </div>
    </JobActionDialog>
  )
}

/** See `SIZE_MISMATCH_REASON_TO_PAK` above - `{}` for every other reason key, so `t()` renders the
 * static string unchanged. Mirrors `GameDataStep.tsx`'s own `sizeMismatchParams` helper. */
function sizeMismatchParams(
  inspection: DetectedRetailSource['inspection'],
  reasonKey: string,
): Record<string, string> {
  const pak = (SIZE_MISMATCH_REASON_TO_PAK as Record<string, 'pak0' | 'pak1' | undefined>)[
    reasonKey
  ]
  if (!pak) return {}
  return { actualSize: formatBytes(inspection[pak].sizeBytes ?? undefined) }
}
