import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BootstrapEngineOption,
  BootstrapSummary,
  BootstrapTargetVerdict,
} from '@shared/modules/downloads'
import { invoke } from '../../../lib/bridge'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import {
  getBootstrapEngineOptions,
  getBootstrapSummary,
  getBootstrapTargetVerdict,
  startBootstrapInstall,
} from '../client'
import { EngineStep } from './EngineStep'
import { TargetStep } from './TargetStep'
import { ConfirmStep } from './ConfirmStep'
import { RunningStep } from './RunningStep'

type Step = 'engine' | 'target' | 'confirm' | 'running'

const STEP_ORDER: Step[] = ['engine', 'target', 'confirm', 'running']

/**
 * Story 074 D6: the bootstrap wizard - engine (fixed to Q2PRO) -> target folder (with the D2
 * verdict's warnings) -> confirm (packages + size + target, AC4) -> run (hands off to the D4 job,
 * AC5). Mirrors `CreateInstallationDialog.tsx` for dialog shape.
 *
 * Wizard state lives here, in `useState`, and is never persisted - closing the dialog before
 * `running` throws all of it away, same as `CreateInstallationDialog`.
 *
 * The Program Files remedy holds the picked path in local wizard state (`writeDirPath`) and
 * passes it through `StartBootstrapInput.writeDirPath` when the job starts - there is no
 * installation yet at pick time for `ChecksList.tsx`'s `updateInstallation({ id, writeDirPath })`
 * remedy to target directly, so `bootstrap/job.ts` applies the same `InstallationsService.update()`
 * call itself, right after `create()`. The write-dir remedy also remains available afterwards from
 * the created installation's own checks list, same as any other installation.
 */
export function BootstrapWizard() {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)

  const [step, setStep] = useState<Step>('engine')

  const [engineOptions, setEngineOptions] = useState<BootstrapEngineOption[] | null>(null)

  const [targetPath, setTargetPath] = useState('')
  const [verdict, setVerdict] = useState<BootstrapTargetVerdict | null>(null)
  const [checkingTarget, setCheckingTarget] = useState(false)
  const [ackProgramFiles, setAckProgramFiles] = useState(false)
  const [ackNonEmpty, setAckNonEmpty] = useState(false)
  const [ackNotWritable, setAckNotWritable] = useState(false)
  const [writeDirPath, setWriteDirPath] = useState<string | null>(null)

  const [includeVideoAndPlayers, setIncludeVideoAndPlayers] = useState(false)
  const [summary, setSummary] = useState<BootstrapSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useLauncher((state) => state.jobs.find((candidate) => candidate.id === jobId))

  useEffect(() => {
    let cancelled = false
    void getBootstrapEngineOptions().then((result) => {
      if (cancelled) return
      setEngineOptions(result.ok ? result.value : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Reset the acknowledges whenever the target folder itself changes - an acknowledge for one
  // folder must never silently carry over to a different one.
  useEffect(() => {
    if (!targetPath) {
      setVerdict(null)
      return
    }
    setAckProgramFiles(false)
    setAckNonEmpty(false)
    setAckNotWritable(false)
    // A write-dir picked via the Program Files remedy is scoped to the target it was picked for -
    // re-picking a different target must not silently carry it over onto the new one (review
    // finding, story 074 fix cycle 2).
    setWriteDirPath(null)
    setCheckingTarget(true)
    let cancelled = false
    void getBootstrapTargetVerdict(targetPath).then((result) => {
      if (cancelled) return
      setCheckingTarget(false)
      setVerdict(result.ok ? result.value : null)
    })
    return () => {
      cancelled = true
    }
  }, [targetPath])

  const engine = engineOptions && engineOptions.length > 0 ? engineOptions[0].engine : null

  useEffect(() => {
    if (step !== 'confirm' || !engine) return
    setSummaryLoading(true)
    setSummaryError(null)
    let cancelled = false
    void getBootstrapSummary({ engine, targetPath, includeVideoAndPlayers }).then((result) => {
      if (cancelled) return
      setSummaryLoading(false)
      if (result.ok) {
        setSummary(result.value)
      } else {
        setSummary(null)
        setSummaryError(t(result.error.key, result.error.params ?? {}))
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, engine, targetPath, includeVideoAndPlayers])

  async function pickTargetFolder(): Promise<void> {
    const picked = await invoke('installations:pickFolder', {
      title: t('bootstrapWizard.target.pickTitle'),
      buttonLabel: t('bootstrapWizard.target.pickButton'),
    })
    if (picked) setTargetPath(picked)
  }

  async function pickWriteDirRemedy(): Promise<void> {
    // Same `installations:pickFolder` call `ChecksList.tsx`'s `set-write-dir` remedy uses. There is
    // no installation yet at this point, so the picked path is held in wizard state and threaded
    // through `StartBootstrapInput.writeDirPath` at `start()` - `bootstrap/job.ts` applies it via
    // `InstallationsService.update()` right after `create()`, the same field that remedy writes.
    const picked = await invoke('installations:pickFolder', {
      title: t('installation.action.setWriteDir'),
      defaultPath: targetPath,
    })
    if (picked) setWriteDirPath(picked)
  }

  const targetWarningsAcknowledged =
    (!verdict?.programFiles || ackProgramFiles) &&
    (!(verdict?.entries.length ?? 0) || ackNonEmpty) &&
    (!verdict?.notWritable || ackNotWritable)

  const canProceed: Record<Step, boolean> = {
    engine: !!engine,
    target: !!verdict && !verdict.blocked && targetWarningsAcknowledged,
    confirm: !!summary && !starting,
    running: false,
  }

  function goNext(): void {
    const index = STEP_ORDER.indexOf(step)
    if (index < STEP_ORDER.length - 1) setStep(STEP_ORDER[index + 1])
  }

  function goBack(): void {
    const index = STEP_ORDER.indexOf(step)
    if (index > 0) setStep(STEP_ORDER[index - 1])
  }

  async function start(): Promise<void> {
    if (!engine || !summary) return
    setStarting(true)
    setStartError(null)
    const result = await startBootstrapInstall({
      engine,
      targetPath,
      includeVideoAndPlayers,
      ...(writeDirPath ? { writeDirPath } : {}),
    })
    setStarting(false)
    if (result.ok) {
      setJobId(result.value.jobId)
      setStep('running')
    } else {
      setStartError(t(result.error.key, result.error.params ?? {}))
    }
  }

  const running = step === 'running'

  return (
    <Modal
      open
      title={t('bootstrapWizard.title')}
      description={t(`bootstrapWizard.step.${step}`)}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      preventClose={starting}
      footer={
        running ? (
          <Button variant="primary" onClick={closeDialog} data-testid="bootstrap-running-dismiss">
            {t('bootstrapWizard.running.dismiss')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={closeDialog} disabled={starting}>
              {t('common.cancel')}
            </Button>
            {step !== 'engine' && (
              <Button variant="ghost" onClick={goBack} disabled={starting}>
                {t('bootstrapWizard.back')}
              </Button>
            )}
            {step === 'confirm' ? (
              <Button
                variant="primary"
                disabled={!canProceed.confirm}
                onClick={() => void start()}
                data-testid="bootstrap-confirm-start"
              >
                {t('bootstrapWizard.confirm.start')}
              </Button>
            ) : (
              <Button variant="primary" disabled={!canProceed[step]} onClick={goNext}>
                {t('bootstrapWizard.next')}
              </Button>
            )}
          </>
        )
      }
    >
      {step === 'engine' && <EngineStep options={engineOptions} />}

      {step === 'target' && (
        <TargetStep
          targetPath={targetPath}
          onBrowse={() => void pickTargetFolder()}
          verdict={verdict}
          checking={checkingTarget}
          ackProgramFiles={ackProgramFiles}
          onAckProgramFilesChange={setAckProgramFiles}
          onPickWriteDir={() => void pickWriteDirRemedy()}
          ackNonEmpty={ackNonEmpty}
          onAckNonEmptyChange={setAckNonEmpty}
          ackNotWritable={ackNotWritable}
          onAckNotWritableChange={setAckNotWritable}
        />
      )}

      {step === 'confirm' && (
        <div className="space-y-3">
          <ConfirmStep
            summary={summary}
            loading={summaryLoading}
            includeVideoAndPlayers={includeVideoAndPlayers}
            onIncludeVideoAndPlayersChange={setIncludeVideoAndPlayers}
          />
          {summaryError && <p className="text-xs text-danger">{summaryError}</p>}
          {startError && <p className="text-xs text-danger">{startError}</p>}
        </div>
      )}

      {step === 'running' && <RunningStep job={job} />}
    </Modal>
  )
}
