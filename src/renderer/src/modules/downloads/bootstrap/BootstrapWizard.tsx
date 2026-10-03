import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EngineKind } from '@shared/types'
import type {
  BootstrapDataSource,
  BootstrapEngineOption,
  BootstrapEngineOptionsEmptyReason,
  BootstrapSummary,
  BootstrapTargetVerdict,
  DetectedRetailSource,
  DownloadFailure,
  GameDataSourceVerdict,
} from '@shared/modules/downloads'
import { ok } from '@shared/types'
import { invoke } from '../../../lib/bridge'
import { useModuleQuery } from '../../../lib/useModuleQuery'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import {
  getBootstrapEngineOptions,
  getBootstrapSummary,
  getBootstrapTargetVerdict,
  getDetectedRetailSources,
  getDownloadFailures,
  getGameDataSourceVerdict,
  startBootstrapInstall,
} from '../client'
import { EngineStep } from './EngineStep'
import { GameDataStep } from './GameDataStep'
import { TargetStep } from './TargetStep'
import { ConfirmStep } from './ConfirmStep'
import { RunningStep } from './RunningStep'

type Step = 'engine' | 'gameData' | 'target' | 'confirm' | 'running'

const STEP_ORDER: Step[] = ['engine', 'gameData', 'target', 'confirm', 'running']

/**
 * Story 074 D6, extended by 080 D2, 088 D5 and 089 D4: the bootstrap wizard - engine choice
 * (Q2PRO, R1Q2 once both are pinned) -> game data (free download, a copy of a detected
 * Steam/GOG/Epic installation [[088]], or a hand-picked folder [[089]]) -> target folder (with the
 * D2 verdict's warnings) -> confirm (packages + size + target, AC4) -> run (hands off to the D4
 * job, AC5). Mirrors `CreateInstallationDialog.tsx` for dialog shape.
 *
 * `dataSource`/`copySourcePath` hold the game-data step's choice; `detectedSources` is fetched
 * once on mount, same convention as `engineOptions` below - an empty array means the game-data
 * step never offers the copy choice at all (AC1). `gameDataFolderPath`/`gameDataFolderVerdict`
 * are the `'existing-folder'` choice's own state ([[089]] D4) - resolved on demand, whenever the
 * user browses, rather than fetched once like `detectedSources`. `copySourcePath` is reused
 * verbatim for that choice's own picked path when a run starts or a summary is fetched
 * (`StartBootstrapInput.copySourcePath`'s own doc comment) - it is never a second field.
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
  const openDialog = useLauncher((state) => state.openDialog)

  const [step, setStep] = useState<Step>('engine')

  const engineQuery = useModuleQuery(getBootstrapEngineOptions)
  // A failed read means "no options, no reason to give" (same as an empty list); `null` = loading.
  const engineOptions: BootstrapEngineOption[] | null =
    engineQuery.data?.options ?? (engineQuery.state === 'loading' ? null : [])
  // Story 100 D7/D8: why `engineOptions` came back empty - `null` whenever it is non-empty (or
  // still loading). Rendered by `EngineStep`'s own empty state; never read for anything else.
  const engineOptionsEmptyReason: BootstrapEngineOptionsEmptyReason =
    engineQuery.data?.emptyReason ?? null
  // Defaults to the first option so a single-choice wizard (today's Q2PRO-only reality) needs zero
  // extra clicks - derived, so it is there in the same render as the options; a pick always wins.
  const [pickedEngine, setPickedEngine] = useState<EngineKind | null>(null)
  const engine: EngineKind | null = pickedEngine ?? engineQuery.data?.options[0]?.engine ?? null

  const sourcesQuery = useModuleQuery(getDetectedRetailSources)
  // An empty list makes the copy choice absent rather than disabled (`GameDataStep` reads
  // `sources.length`, never a loading placeholder, to decide that).
  const detectedSources: DetectedRetailSource[] | null =
    sourcesQuery.data ?? (sourcesQuery.state === 'loading' ? null : [])
  const [dataSource, setDataSource] = useState<BootstrapDataSource>('free-download')
  const [copySourcePath, setCopySourcePath] = useState<string | null>(null)

  // Story 089 D4: the `'existing-folder'` choice's own path + resolved verdict - mirrors the
  // `copySourcePath`/`detectedSources` pair above, but keyed on one hand-picked folder rather than
  // a list. `folderVerdict` is reset to `null` whenever the folder itself changes, same convention
  // as the target step's verdict reset on `targetPath` change below.
  const [gameDataFolderPath, setGameDataFolderPath] = useState<string | null>(null)
  const [gameDataFolderVerdict, setGameDataFolderVerdict] = useState<GameDataSourceVerdict | null>(
    null,
  )
  const [checkingGameDataFolder, setCheckingGameDataFolder] = useState(false)

  const [targetPath, setTargetPath] = useState('')
  const verdictQuery = useModuleQuery<BootstrapTargetVerdict | null>(
    async () => (targetPath ? getBootstrapTargetVerdict(targetPath) : ok(null)),
    { deps: [targetPath] },
  )
  const verdict =
    targetPath && verdictQuery.state === 'success' ? (verdictQuery.data ?? null) : null
  const checkingTarget = targetPath !== '' && verdictQuery.state === 'loading'
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

  // Story 078 D7 (AC4): once the job turns `failed`, fetch the failure log the same way the
  // Downloads tab does (`getDownloadFailures()`) and match on `jobId` - no new IPC channel, no
  // widening of the `jobs:changed` payload (Decisions (Sprint)). `fetchedForJobId` guards against
  // refetching on every subsequent `jobs:changed` tick while the job stays `failed` - `job`'s
  // object identity changes on every tick even when nothing relevant changed, so the guard keys
  // on the job id itself rather than on effect deps alone.
  const [failure, setFailure] = useState<DownloadFailure | undefined>(undefined)
  const fetchedForJobId = useRef<string | null>(null)

  useEffect(() => {
    if (!job || job.status !== 'failed') return
    if (fetchedForJobId.current === job.id) return
    fetchedForJobId.current = job.id
    let cancelled = false
    void getDownloadFailures().then((result) => {
      if (cancelled) return
      setFailure(
        result.ok ? result.value.find((candidate) => candidate.jobId === job.id) : undefined,
      )
    })
    return () => {
      cancelled = true
    }
  }, [job])

  function selectEngine(next: EngineKind): void {
    setPickedEngine(next)
  }

  function selectDataSource(next: BootstrapDataSource): void {
    setDataSource(next)
    if (next === 'free-download') {
      setCopySourcePath(null)
      return
    }
    // Story 089 D4: `'existing-folder'` has no detected list to default from - it stays exactly
    // whatever the user last browsed to (`gameDataFolderPath`/`gameDataFolderVerdict`, untouched
    // here), same "never overwrite what the user already picked" rule as the `store-copy` default
    // below just applies to a different piece of state.
    if (next === 'existing-folder') return
    // Defaults to the first verified detected source, same "zero extra clicks" convention as
    // `selectEngine`'s default-selection effect - but never overwrites a path the user already
    // picked from the source list.
    if (copySourcePath === null) {
      const firstVerified = (detectedSources ?? []).find(
        (candidate) => candidate.inspection.verified,
      )
      if (firstVerified) setCopySourcePath(firstVerified.rootPath)
    }
  }

  const selectedCopySource =
    dataSource === 'store-copy'
      ? (detectedSources ?? []).find((candidate) => candidate.rootPath === copySourcePath)
      : undefined

  // Story 088 D5 (toggle availability rule): the chosen detected source is inspected up front -
  // when it has neither `baseq2/video` nor `baseq2/players`, the confirm step's toggle is disabled
  // with this reason rather than left enabled to fail the copy afterwards.
  const includeExtrasDisabledReason =
    selectedCopySource &&
    !selectedCopySource.inspection.hasVideo &&
    !selectedCopySource.inspection.hasPlayers
      ? t('bootstrapWizard.confirm.includeExtrasDisabledReason')
      : undefined

  // Story 089 D5 (Decisions: "no video/players toggle for this source in this story"): an
  // existing-folder run hides the toggle outright, rather than disabling it with a reason the way
  // `store-copy` does - 089's criteria never mention it, and the toggle's payload comes from the
  // point-release archive this source does not download.
  const hideIncludeExtras = dataSource === 'existing-folder'

  // A source that stops qualifying for the toggle (freshly chosen, or the wizard's own state
  // change) must never leave a stale `true` behind - same reset convention as the target step's
  // acknowledges.
  useEffect(() => {
    if (includeExtrasDisabledReason || hideIncludeExtras) setIncludeVideoAndPlayers(false)
  }, [includeExtrasDisabledReason, hideIncludeExtras])

  // Reset the acknowledges whenever the target folder itself changes - an acknowledge for one
  // folder must never silently carry over to a different one.
  useEffect(() => {
    if (!targetPath) return
    setAckProgramFiles(false)
    setAckNonEmpty(false)
    setAckNotWritable(false)
    // A write-dir picked via the Program Files remedy is scoped to the target it was picked for -
    // re-picking a different target must not silently carry it over onto the new one (review
    // finding, story 074 fix cycle 2).
    setWriteDirPath(null)
  }, [targetPath])

  useEffect(() => {
    if (step !== 'confirm' || !engine) return
    setSummaryLoading(true)
    setSummaryError(null)
    let cancelled = false
    // Story 089 D4: `'existing-folder'` reuses `copySourcePath` verbatim (`StartBootstrapInput`'s
    // own doc comment) - the field already means "path to copy game data from", so this sends
    // `gameDataFolderPath` through it rather than adding a second field.
    void getBootstrapSummary({
      engine,
      targetPath,
      includeVideoAndPlayers,
      dataSource,
      ...(dataSource === 'store-copy' && copySourcePath ? { copySourcePath } : {}),
      ...(dataSource === 'existing-folder' && gameDataFolderPath
        ? { copySourcePath: gameDataFolderPath }
        : {}),
    }).then((result) => {
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
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the effect re-runs on the listed inputs only; the remaining closure values are read as of that run.
  }, [
    step,
    engine,
    targetPath,
    includeVideoAndPlayers,
    dataSource,
    copySourcePath,
    gameDataFolderPath,
  ])

  async function pickTargetFolder(): Promise<void> {
    const picked = await invoke('installations:pickFolder', {
      title: t('bootstrapWizard.target.pickTitle'),
      buttonLabel: t('common.action.useThisFolder'),
    })
    if (picked) setTargetPath(picked)
  }

  // Story 089 D4: browsing for the `'existing-folder'` game-data source - same `installations:
  // pickFolder` call shape as `pickTargetFolder`/`pickWriteDirRemedy` above, then a
  // `getGameDataSourceVerdict` round trip for AC2's "the wizard reports what it found there before
  // the user can proceed". A cancelled picker (no path) leaves the previous folder/verdict alone.
  async function pickGameDataSourceFolder(): Promise<void> {
    const picked = await invoke('installations:pickFolder', {
      title: t('bootstrapWizard.gameData.existingFolder.pickTitle'),
      buttonLabel: t('common.action.useThisFolder'),
    })
    if (!picked) return
    setGameDataFolderPath(picked)
    setGameDataFolderVerdict(null)
    setCheckingGameDataFolder(true)
    const result = await getGameDataSourceVerdict(picked)
    setCheckingGameDataFolder(false)
    setGameDataFolderVerdict(result.ok ? result.value : null)
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
    // Story 088 fix cycle (review F4): `detectedSources` must have resolved (empty array or
    // populated - `null` only while `getDetectedRetailSources()` is still in flight) before a fast
    // user can leave this step. Without this, the default `'free-download'` choice would let
    // someone click past before ever finding out a copy option exists - `GameDataStep` already
    // renders a loading message for `sources === null` (see its own `if (sources === null)`
    // branch), so this keeps Next disabled for exactly the same window that message is shown.
    // Story 089 D4: `'existing-folder'` gates on a resolved, non-`'unusable'` verdict for the
    // picked folder - `'retail'` and `'demo'` both proceed (AC4), `'unusable'` never does (AC5),
    // and a folder that has not resolved yet (`null`, still checking, or never browsed) blocks
    // Next the same way `detectedSources === null` blocks it above.
    gameData:
      detectedSources !== null &&
      (dataSource === 'free-download' ||
        (dataSource === 'store-copy' && !!selectedCopySource?.inspection.verified) ||
        (dataSource === 'existing-folder' &&
          !!gameDataFolderVerdict &&
          gameDataFolderVerdict.kind !== 'unusable')),
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
      dataSource,
      ...(dataSource === 'store-copy' && copySourcePath ? { copySourcePath } : {}),
      ...(dataSource === 'existing-folder' && gameDataFolderPath
        ? { copySourcePath: gameDataFolderPath }
        : {}),
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
      closeLabel={t('common.action.close')}
      preventClose={starting}
      footer={
        running ? (
          <Button variant="primary" onClick={closeDialog} data-testid="bootstrap-running-dismiss">
            {t('common.action.runInBackground')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={closeDialog} disabled={starting}>
              {t('common.action.cancel')}
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
      {step === 'engine' && (
        <EngineStep
          options={engineOptions}
          emptyReason={engineOptionsEmptyReason}
          selected={engine}
          onSelect={selectEngine}
          // Story 100 D8 (AC7): the empty state's action - the same `openDialog({ kind:
          // 'add-existing' })` call `DetectDialog.tsx`'s own "nothing found" empty state already
          // uses, not a second "add existing" mechanism. `Dialogs.tsx` mounts exactly one dialog
          // at a time off `store.dialog.kind`, so this alone swaps this wizard out for
          // `AddExistingDialog` - no separate `closeDialog()` call needed, same as `DetectDialog`.
          onAddExisting={() => openDialog({ kind: 'add-existing' })}
        />
      )}

      {step === 'gameData' && (
        <GameDataStep
          sources={detectedSources}
          dataSource={dataSource}
          onDataSourceChange={selectDataSource}
          copySourcePath={copySourcePath}
          onCopySourcePathChange={setCopySourcePath}
          folderPath={gameDataFolderPath}
          onBrowseFolder={() => void pickGameDataSourceFolder()}
          folderVerdict={gameDataFolderVerdict}
          checkingFolder={checkingGameDataFolder}
        />
      )}

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
            includeExtrasDisabledReason={includeExtrasDisabledReason}
            hideIncludeExtras={hideIncludeExtras}
          />
          {summaryError && <p className="text-xs text-danger">{summaryError}</p>}
          {startError && <p className="text-xs text-danger">{startError}</p>}
        </div>
      )}

      {step === 'running' && <RunningStep job={job} failure={failure} />}
    </Modal>
  )
}
