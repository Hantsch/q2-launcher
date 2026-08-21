import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CleanupApplyResult,
  CleanupFinding,
  CleanupRestoreResult,
  CleanupScanResult,
} from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import type { Installation } from '@shared/types/installation'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { Badge, EmptyState, SectionLabel, Spinner } from '../../components/ui/primitives'
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
 * Story 025 D7: moved off the config module's list screen into the Care tab,
 * where it is scoped to the profile it is mounted under - the installation
 * picker defaults to `assignedInstallationIds` rather than every registered
 * installation, with a "scan any installation" checkbox (mirroring
 * `EngineScopeSelect`'s scope-control wording) that widens it back to the
 * full `installations` list. Nothing here is persisted (decision 14): the
 * scan, the selection and the last apply/restore result all live in this
 * component's own state and are lost on a re-scan, a new installation pick,
 * or leaving the panel - the on-disk backup that makes undo possible is D2's
 * job, already done in main.
 *
 * Read-only until "Remove selected" is confirmed, mirroring
 * `ImportProfileDialog`'s discipline: `cleanup.scan` never writes anything,
 * so switching installations or re-scanning costs nothing.
 */
export function CleanupPanel({
  installations,
  assignedInstallationIds,
  onStatusChange,
}: {
  installations: Installation[]
  assignedInstallationIds: string[]
  /** Story 025 D8: mirrors `scanResult` out to `CareTab`'s summary, since that
   * state is otherwise fully internal to this panel (decision 14, "nothing
   * here is persisted"). Fired whenever `scanResult` changes, including back
   * to `{ scanned: false, itemCount: 0 }` on every reset below (an
   * installation change, or right after a successful apply) - the same case
   * the story's test-plan step 11 calls out for a reload, generalised to any
   * reset within the session. A failed scan (the installation is running)
   * does not count as "checked": no real answer was obtained. Optional, so
   * mounting this panel without the prop is unchanged. */
  onStatusChange?: (status: { scanned: boolean; itemCount: number }) => void
}) {
  const { t } = useTranslation()
  const installationSelectId = useId()

  // Widening is a plain toggle, not persisted (same "nothing here survives a
  // re-scan or a leave" rule as the rest of this panel's session state).
  const [scopeWidened, setScopeWidened] = useState(false)
  const scopedInstallations = useMemo(
    () =>
      scopeWidened
        ? installations
        : installations.filter((entry) => assignedInstallationIds.includes(entry.id)),
    [installations, assignedInstallationIds, scopeWidened],
  )

  const [installationId, setInstallationId] = useState('')

  // A selection that falls outside the current scope - narrowing back after
  // widening, or a first mount where the profile has no assigned
  // installations yet - is cleared rather than left silently selected
  // outside what the picker now offers.
  useEffect(() => {
    if (installationId && !scopedInstallations.some((entry) => entry.id === installationId)) {
      setInstallationId('')
    }
  }, [scopedInstallations, installationId])

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<Outcome<CleanupScanResult> | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<Outcome<CleanupApplyResult> | null>(null)

  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState(false)
  const [restoreResult, setRestoreResult] = useState<Outcome<CleanupRestoreResult> | null>(null)

  // Picking a different installation invalidates every piece of session state
  // below it - same discipline as `ImportProfileDialog`'s installation-change
  // effect, just with nothing to auto-scan into (this panel scans on demand).
  useEffect(() => {
    setScanResult(null)
    setSelected(new Set())
    setConfirmOpen(false)
    setApplyResult(null)
    setUndoing(false)
    setUndone(false)
    setRestoreResult(null)
  }, [installationId])

  // Reports out on every `scanResult` change, whatever caused it (a scan
  // succeeding or failing, or one of the resets above setting it back to
  // `null`) - one place, rather than repeating the same notification at every
  // call site that touches `scanResult`. `onStatusChange` itself is read via
  // closure rather than listed as a dependency: an inline callback from
  // `CareTab` gets a new identity every render, and this must only fire when
  // `scanResult` itself actually changes.
  useEffect(() => {
    onStatusChange?.({
      scanned: scanResult !== null && scanResult.ok,
      itemCount: scanResult?.ok ? scanResult.value.findings.length : 0,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanResult])

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
    <div className="space-y-3">
      <SectionLabel>{t('config.cleanup.label')}</SectionLabel>

      {installations.length === 0 ? (
        <EmptyState
          title={t('config.cleanup.noInstallations.title')}
          body={t('config.cleanup.noInstallations.body')}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label={t('config.cleanup.installationLabel')}
              htmlFor={installationSelectId}
              className="min-w-56 flex-1"
            >
              <Select
                id={installationSelectId}
                value={installationId}
                onChange={(event) => setInstallationId(event.target.value)}
                options={[
                  {
                    value: '',
                    label: t('config.cleanup.installationPlaceholder'),
                    disabled: true,
                  },
                  ...scopedInstallations.map((entry) => ({ value: entry.id, label: entry.name })),
                ]}
              />
            </Field>
            <Button
              variant="neutral"
              size="sm"
              disabled={!installationId || scanning}
              onClick={() => void handleScan()}
            >
              {scanning ? t('config.cleanup.scanning') : t('config.cleanup.scan')}
            </Button>
          </div>

          <div className="space-y-1">
            <Checkbox
              checked={scopeWidened}
              onChange={() => setScopeWidened((prev) => !prev)}
              label={t('config.cleanup.scope.widen')}
            />
            <p className="text-xs leading-relaxed text-ink-muted">
              {scopeWidened ? t('config.cleanup.scope.hintWidened') : t('config.cleanup.scope.hint')}
            </p>
          </div>

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
      )}

      {confirmOpen && (
        <Modal
          open
          size="sm"
          title={t('config.cleanup.confirmDialog.title')}
          onClose={() => setConfirmOpen(false)}
          closeLabel={t('common.close')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
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
    </div>
  )
}
