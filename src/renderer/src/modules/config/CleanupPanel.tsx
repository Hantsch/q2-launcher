import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CleanupApplyResult,
  CleanupFinding,
  CleanupRestoreResult,
  CleanupScanResult,
} from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { Badge, EmptyState, Spinner } from '../../components/ui/primitives'
import { formatBytes } from '../../lib/format'
import { applyCleanup, restoreCleanup, scanCleanupFindings } from './client'

/** Stable key for a finding/entry, since neither has an id of its own (decision 7: addressed by `{ gameDir, fileName }`, never by a path or a generated id). */
function findingKey(entry: { gameDir: string; fileName: string }): string {
  return `${entry.gameDir}\u0000${entry.fileName}`
}

/**
 * Story 010 D4: scans an installation for mod-folder `.cfg` files that
 * duplicate a same-named `baseq2` file, and lets the user review, remove and
 * (per decision 6) undo that removal.
 *
 * Story 025 D7 moved it off the config module's list screen into the Care tab
 * with an installation picker and a "scan any installation" scope control;
 * story 058 D6 takes both away again. The panel is now mounted by
 * `CleanupConfigCopiesDialog` from an installation row in Library, and the row
 * *is* the scope - there is one `installationId`, handed in as a prop, and
 * every scan, apply and restore call below uses it. Its `onStatusChange`
 * callback is gone with it: a manual scan is not a status, so Care no longer
 * reports on one (AC 2).
 *
 * Nothing here is persisted (story 010 decision 14): the scan, the selection
 * and the last apply/restore result all live in this component's own state and
 * are lost on a re-scan or on closing the dialog - the on-disk backup that
 * makes undo possible is D2's job, already done in main.
 *
 * Read-only until "Remove selected" is confirmed, mirroring
 * `ImportProfileDialog`'s discipline: `cleanup.scan` never writes anything, so
 * re-scanning costs nothing.
 */
export function CleanupPanel({ installationId }: { installationId: string }) {
  const { t } = useTranslation()

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<Outcome<CleanupScanResult> | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<Outcome<CleanupApplyResult> | null>(null)

  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState(false)
  const [restoreResult, setRestoreResult] = useState<Outcome<CleanupRestoreResult> | null>(null)

  // A changed `installationId` invalidates every piece of session state below
  // it. The dialog above normally unmounts between installations, so this is a
  // guard rather than a routine path - but it is the guard that matters most
  // here: findings, the selection and `applyResult.removed` (what Undo restores)
  // are all lists of file names that only mean anything against the
  // installation they were scanned from. It runs before any click can reach
  // apply or undo, so neither can ever be sent with one installation's file
  // list and another's id.
  useEffect(() => {
    setScanResult(null)
    setSelected(new Set())
    setConfirmOpen(false)
    setApplyResult(null)
    setUndoing(false)
    setUndone(false)
    setRestoreResult(null)
  }, [installationId])

  const findings: CleanupFinding[] = scanResult?.ok ? scanResult.value.findings : []
  const selectedFindings = findings.filter((finding) => selected.has(findingKey(finding)))

  const handleScan = async (): Promise<void> => {
    if (!installationId) return
    setScanning(true)
    setScanResult(null)
    setSelected(new Set())
    setConfirmOpen(false)
    setApplyResult(null)
    setUndoing(false)
    setUndone(false)
    setRestoreResult(null)
    const result = await scanCleanupFindings({ installationId })
    setScanning(false)
    setScanResult(result)
    if (result.ok) {
      // Pre-select only the byte-identical findings (decision 3) - a copy
      // that differs from baseq2 might be intentional, so it starts unchecked.
      const next = new Set<string>()
      for (const finding of result.value.findings) {
        if (finding.identical) next.add(findingKey(finding))
      }
      setSelected(next)
    }
  }

  const toggleFinding = (finding: CleanupFinding): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      const key = findingKey(finding)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openConfirm = (): void => {
    // Clear any stale error from a previous failed attempt so the confirm
    // dialog does not show it before this attempt has even run.
    setApplyResult(null)
    setConfirmOpen(true)
  }

  const handleConfirmRemove = async (): Promise<void> => {
    setApplying(true)
    const result = await applyCleanup({
      installationId,
      entries: selectedFindings.map((finding) => ({
        gameDir: finding.gameDir,
        fileName: finding.fileName,
      })),
    })
    setApplying(false)
    setApplyResult(result)
    setUndone(false)
    setRestoreResult(null)
    if (result.ok) {
      setConfirmOpen(false)
      // The result section below takes over from here; a fresh scan is
      // needed to see the findings list again (decision 14).
      setScanResult(null)
      setSelected(new Set())
    }
    // On failure the findings list and selection are left untouched (the
    // deliverable's own wording) - the game may just need to be closed first.
  }

  const handleUndo = async (): Promise<void> => {
    if (!applyResult?.ok) return
    setUndoing(true)
    const result = await restoreCleanup({ installationId, entries: applyResult.value.removed })
    setUndoing(false)
    setRestoreResult(result)
    if (result.ok) setUndone(true)
  }

  return (
    <>
      <div className="space-y-3">
        <Button
          variant="neutral"
          size="sm"
          disabled={!installationId || scanning}
          onClick={() => void handleScan()}
        >
          {scanning ? t('config.cleanup.scanning') : t('config.cleanup.scan')}
        </Button>

        {scanning && (
          <div className="flex items-center justify-center py-6">
            <Spinner />
          </div>
        )}

        {!scanning && scanResult && !scanResult.ok && (
          <p className="text-xs text-danger">{t(scanResult.error.key, scanResult.error.params)}</p>
        )}

        {!scanning && scanResult?.ok && findings.length === 0 && (
          <EmptyState
            title={t('config.cleanup.empty.title')}
            body={t('config.cleanup.empty.body')}
          />
        )}

        {!scanning && findings.length > 0 && (
          <div className="space-y-2">
            <ul className="space-y-1.5">
              {findings.map((finding) => {
                const key = findingKey(finding)
                return (
                  <li
                    key={key}
                    className="flex flex-wrap items-center gap-2.5 rounded-sm border border-line px-2.5 py-2"
                  >
                    <Checkbox
                      checked={selected.has(key)}
                      onChange={() => toggleFinding(finding)}
                      label={
                        <span className="numeric truncate text-sm text-ink">
                          {finding.gameDir}/{finding.fileName}
                        </span>
                      }
                      className="min-w-0 flex-1"
                    />
                    <span className="numeric shrink-0 text-xs text-ink-muted">
                      {formatBytes(finding.size ?? undefined)}
                    </span>
                    {!finding.identical && (
                      <Badge tone="warning">{t('config.cleanup.differs')}</Badge>
                    )}
                  </li>
                )
              })}
            </ul>

            {applyResult && !applyResult.ok && (
              <p className="text-xs text-danger">
                {t(applyResult.error.key, applyResult.error.params)}
              </p>
            )}

            <Button
              variant="danger"
              size="sm"
              disabled={selectedFindings.length === 0 || applying}
              onClick={openConfirm}
            >
              {t('config.cleanup.removeSelected')}
            </Button>
          </div>
        )}

        {applyResult?.ok && (
          <div className="space-y-2 rounded-sm border border-line px-2.5 py-2">
            <p className="text-xs text-ink-dim">
              {t('config.cleanup.result.removed', { count: applyResult.value.removed.length })}
            </p>
            {applyResult.value.rejected.length > 0 && (
              <p className="text-xs text-ink-muted">
                {t('config.cleanup.result.rejected', {
                  count: applyResult.value.rejected.length,
                })}
              </p>
            )}
            {restoreResult && !restoreResult.ok && (
              <p className="text-xs text-danger">
                {t(restoreResult.error.key, restoreResult.error.params)}
              </p>
            )}
            {undone ? (
              <Badge tone="success">{t('config.cleanup.result.undone')}</Badge>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={undoing}
                onClick={() => void handleUndo()}
              >
                {t('config.cleanup.result.undo')}
              </Button>
            )}
          </div>
        )}
      </div>

      {confirmOpen && (
        <Modal
          open
          size="sm"
          title={t('config.cleanup.confirmDialog.title')}
          onClose={() => setConfirmOpen(false)}
          closeLabel={t('common.close')}
          // Story 058 review fix: while the apply is in flight, this dialog is the only place
          // holding the removed-entries list `handleUndo` needs - an Escape/backdrop/close here
          // must not unmount it and silently lose the "Undo removal" entry point.
          preventClose={applying}
          footer={
            <>
              <Button variant="ghost" disabled={applying} onClick={() => setConfirmOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={applying}
                onClick={() => void handleConfirmRemove()}
              >
                {t('config.cleanup.confirmDialog.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <p className="text-sm leading-relaxed text-ink-dim">
              {t('config.cleanup.confirmDialog.body', { count: selectedFindings.length })}
            </p>
            {applyResult && !applyResult.ok && (
              <p className="text-xs text-danger">
                {t(applyResult.error.key, applyResult.error.params)}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
