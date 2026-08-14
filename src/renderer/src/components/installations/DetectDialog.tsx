import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive, Search } from 'lucide-react'
import { engineLabel, type DetectedInstallation, type DetectionProgress } from '@shared/types'
import { cn } from '../../lib/cn'
import { invoke, onEvent } from '../../lib/bridge'
import { newId } from '../../lib/id'
import { shortenPath } from '../../lib/format'
import { useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/controls'
import { Badge, SectionLabel, Spinner } from '../ui/primitives'
import { Modal } from '../ui/Modal'
import { ProgressBar } from '../ui/ProgressBar'

/**
 * Search this PC for installations.
 *
 * Two passes with very different costs, so they are separate choices: the fast
 * pass asks Steam, GOG and Epic where they put things and probes the classic
 * paths; the deep scan walks drives and has to be asked for. Either way the scan
 * is cancellable and read-only.
 */
export function DetectDialog({ autoStart = false }: { autoStart?: boolean }) {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)
  const openDialog = useLauncher((state) => state.openDialog)
  const importDetected = useLauncher((state) => state.importDetected)

  const [scanId, setScanId] = useState<string | null>(null)
  const [progress, setProgress] = useState<DetectionProgress | null>(null)
  const [candidates, setCandidates] = useState<DetectedInstallation[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deepScan, setDeepScan] = useState(false)
  const [importing, setImporting] = useState(false)
  const scanIdRef = useRef<string | null>(null)

  // Progress arrives on a push channel; filter to the scan we started.
  useEffect(() => {
    return onEvent('detection:progress', (event) => {
      if (event.scanId === scanIdRef.current) setProgress(event)
    })
  }, [])

  const startScan = useCallback(async (withDeepScan: boolean) => {
    const id = newId()
    scanIdRef.current = id
    setScanId(id)
    setProgress(null)
    setCandidates(null)
    setSelected(new Set())

    const result = await invoke('detection:scan', { scanId: id, deepScan: withDeepScan })
    if (scanIdRef.current !== id) return

    setScanId(null)
    setCandidates(result.candidates)
    // Pre-select everything new; the already-registered ones stay untouched.
    setSelected(
      new Set(
        result.candidates
          .filter((candidate) => !candidate.alreadyRegistered)
          .map((candidate) => candidate.rootPath),
      ),
    )
  }, [])

  useEffect(() => {
    if (autoStart) void startScan(false)
  }, [autoStart, startScan])

  const cancelScan = (): void => {
    if (scanId) void invoke('detection:cancel', scanId)
    scanIdRef.current = null
    setScanId(null)
  }

  const submit = async (): Promise<void> => {
    setImporting(true)
    await importDetected([...selected])
    setImporting(false)
    closeDialog()
  }

  const scanning = scanId !== null
  const importable = candidates?.filter((candidate) => !candidate.alreadyRegistered) ?? []

  return (
    <Modal
      open
      size="lg"
      title={t('dialog.detect.title')}
      description={deepScan ? t('dialog.detect.deepBody') : t('dialog.detect.body')}
      onClose={() => {
        cancelScan()
        closeDialog()
      }}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              cancelScan()
              closeDialog()
            }}
          >
            {t('common.cancel')}
          </Button>
          {scanning ? (
            <Button variant="neutral" onClick={cancelScan}>
              {t('dialog.detect.phase.cancelled')}
            </Button>
          ) : candidates === null ? (
            <Button
              variant="primary"
              icon={<Search className="size-4" />}
              onClick={() => void startScan(deepScan)}
            >
              {t('dialog.detect.start')}
            </Button>
          ) : candidates.length === 0 ? (
            // Nothing found is a dead end unless we offer the way out, so the
            // primary action becomes "add it by hand" rather than a disabled
            // "Add 0 selected".
            <Button variant="primary" onClick={() => openDialog({ kind: 'add-existing' })}>
              {t('rail.addExisting')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={selected.size === 0 || importing}
              onClick={() => void submit()}
            >
              {t('dialog.detect.importCount', { count: selected.size })}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!scanning && candidates === null && (
          <Checkbox
            checked={deepScan}
            onChange={setDeepScan}
            label={
              <span className="flex items-center gap-1.5">
                <HardDrive className="size-3.5 text-ink-muted" />
                {t('dialog.detect.deepScan')}
              </span>
            }
          />
        )}

        {scanning && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-ink-dim">
              <Spinner />
              {progress ? t(`dialog.detect.phase.${progress.phase}`) : t('common.loading')}
            </div>
            <ProgressBar
              ratio={progress?.ratio ?? null}
              label={t('dialog.detect.scanning')}
              active
            />
            {progress?.currentPath && (
              <p className="numeric truncate text-[10px] text-ink-faint">
                {t('dialog.detect.scanningPath', { path: shortenPath(progress.currentPath, 60) })}
              </p>
            )}
            <p className="text-[11px] text-ink-muted">
              {t('dialog.detect.found', { count: progress?.candidatesFound ?? 0 })}
            </p>
          </div>
        )}

        {candidates !== null && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>{t('dialog.detect.found', { count: candidates.length })}</SectionLabel>
              {importable.length > 1 && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() =>
                    setSelected(
                      selected.size === importable.length
                        ? new Set()
                        : new Set(importable.map((candidate) => candidate.rootPath)),
                    )
                  }
                >
                  {t('dialog.detect.selectAll')}
                </Button>
              )}
            </div>

            {candidates.length === 0 ? (
              <p className="rounded-md border border-line bg-void/40 p-3 text-xs text-ink-dim">
                {t('dialog.detect.none')}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {candidates.map((candidate) => (
                  <li
                    key={candidate.rootPath}
                    className={cn(
                      'flex items-start gap-3 rounded-sm border p-2.5',
                      candidate.alreadyRegistered
                        ? 'border-line bg-void/30 opacity-60'
                        : 'border-line-strong bg-raised',
                    )}
                  >
                    <Checkbox
                      checked={selected.has(candidate.rootPath)}
                      disabled={candidate.alreadyRegistered}
                      onChange={(checked) => {
                        const next = new Set(selected)
                        if (checked) next.add(candidate.rootPath)
                        else next.delete(candidate.rootPath)
                        setSelected(next)
                      }}
                      label={
                        <span className="block min-w-0 space-y-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm text-ink">
                              {candidate.suggestedName}
                            </span>
                            <Badge tone={candidate.engineKind === 'r1q2' ? 'flame' : 'neutral'}>
                              {engineLabel(candidate.engineKind)}
                            </Badge>
                            <Badge tone="neutral">
                              {t(`installation.source.${candidate.source}`)}
                            </Badge>
                            {candidate.alreadyRegistered && (
                              <Badge tone="strogg">{t('dialog.detect.alreadyAdded')}</Badge>
                            )}
                          </span>
                          <span
                            className="numeric block truncate text-[11px] text-ink-muted"
                            title={candidate.rootPath}
                          >
                            {candidate.rootPath}
                          </span>
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
