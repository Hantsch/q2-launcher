import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { DetectedRetailSource } from '@shared/modules/downloads'
import { formatBytes } from '../../../lib/format'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { getDetectedRetailSources, startRetailUpgrade } from '../client'
import { RunningStep } from '../bootstrap/RunningStep'

/**
 * Story 090 D3: the retail-upgrade dialog - lets a demo installation import `pak0.pak`/`pak1.pak`
 * from a detected Steam/GOG/Epic source (`[[088]]`'s `bootstrap.retailSources`), turning it into a
 * normal, non-demo installation once D2's `retail.upgradeStart` job finishes (INST-D4). Opened via
 * `openDialog({ kind: 'module', moduleId: 'downloads', view: 'retail-upgrade', installationId })` -
 * D4's trigger buttons are a separate deliverable; this component only needs to render correctly
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
 * and this dialog's `data-testid`s are deliberately its own (AC2/AC3/AC6, D6's later e2e flow):
 * `retail-upgrade-dialog` (the picker's container), `retail-upgrade-source-list`,
 * `retail-upgrade-source-item` (one per row, `data-source-path` naming which), `-unverified` (the
 * AC6 rejection reason, present only on an unverified row), `retail-upgrade-no-sources` (AC3's
 * empty state, no picker rendered alongside it), `retail-upgrade-confirm`.
 *
 * AC3's "only a verified source is selectable" rule: an unverified row's button is `disabled` and
 * shows `inspection.unverifiedReason` underneath instead - the same UX `GameDataStep` already uses
 * for the wizard's own copy step, per refine's Decisions ("mirror whatever 088 already does here
 * exactly, don't invent new UX"). The confirm button additionally requires a verified selection,
 * so D2's own `downloads.error.retailSourceUnverified` refusal is a defence-in-depth backstop, not
 * something this dialog relies on for its primary gate.
 */
const SIZE_MISMATCH_REASON_TO_PAK = {
  'bootstrap.retailSource.pak0SizeMismatch': 'pak0',
  'bootstrap.retailSource.pak1SizeMismatch': 'pak1',
} as const

export function RetailUpgradeDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)

  const [sources, setSources] = useState<DetectedRetailSource[] | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useLauncher((state) => state.jobs.find((candidate) => candidate.id === jobId))

  useEffect(() => {
    let cancelled = false
    void getDetectedRetailSources().then((result) => {
      if (cancelled) return
      const list = result.ok ? result.value : []
      setSources(list)
      // Zero-click convenience, same default-selection convention as `BootstrapWizard`'s
      // `selectDataSource`: pick the first verified source so a single-source case needs no click
      // at all, but never overwrite a choice the user already made.
      if (selectedPath === null) {
        const firstVerified = list.find((candidate) => candidate.inspection.verified)
        if (firstVerified) setSelectedPath(firstVerified.rootPath)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedSource = sources?.find((candidate) => candidate.rootPath === selectedPath)
  const canConfirm = !!selectedSource?.inspection.verified && !starting

  async function start(): Promise<void> {
    if (!selectedSource?.inspection.verified) return
    setStarting(true)
    setStartError(null)
    const result = await startRetailUpgrade({
      installationId,
      sourceRootPath: selectedSource.rootPath,
    })
    setStarting(false)
    if (result.ok) {
      setJobId(result.value.jobId)
    } else {
      setStartError(t(result.error.key, result.error.params ?? {}))
    }
  }

  const running = !!jobId

  return (
    <Modal
      open
      title={t('retailUpgrade.title')}
      description={t('retailUpgrade.description')}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      preventClose={starting}
      footer={
        running ? (
          <Button variant="primary" onClick={closeDialog} data-testid="retail-upgrade-dismiss">
            {t('bootstrapWizard.running.dismiss')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={closeDialog} disabled={starting}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!canConfirm}
              onClick={() => void start()}
              data-testid="retail-upgrade-confirm"
            >
              {t('retailUpgrade.confirm')}
            </Button>
          </>
        )
      }
    >
      {running ? (
        <RunningStep job={job} />
      ) : (
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
      )}
    </Modal>
  )
}

/** See `SIZE_MISMATCH_REASON_TO_PAK` above - `{}` for every other reason key, so `t()` renders the
 * static string unchanged. Mirrors `GameDataStep.tsx`'s own `sizeMismatchParams` helper. */
function sizeMismatchParams(
  inspection: DetectedRetailSource['inspection'],
  reasonKey: string,
): Record<string, string> {
  const pak = (SIZE_MISMATCH_REASON_TO_PAK as Record<string, 'pak0' | 'pak1' | undefined>)[reasonKey]
  if (!pak) return {}
  return { actualSize: formatBytes(inspection[pak].sizeBytes ?? undefined) }
}
