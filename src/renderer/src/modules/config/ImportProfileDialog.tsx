import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ConfigProfile,
  ImportGamedirCandidate,
  ImportPreviewResult,
} from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { EmptyState, KeyValue, SectionLabel, Spinner } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { commitImportProfile, previewImportCandidates, scanImportCandidates } from './client'

/**
 * Imports an existing hand-written config into a new profile (story 005).
 *
 * Reached from `CreateProfileDialog` via its "Import from installation" source
 * option (decision 10: a fourth create-profile option, not a separate
 * screen) - `ConfigView` swaps that dialog for this one on `onWantImport`.
 * This dialog owns the multi-step installation -> gamedir -> preview flow a
 * single small form can't hold, then creates the profile through the same
 * "full updated list" contract as every other config mutation.
 *
 * Read-only until Create is pressed: `import.scan`/`import.preview` never
 * write anything (decision 14), and `import.commit` re-reads and re-parses
 * from disk itself rather than trusting anything previewed here back
 * (decision 3) - so nothing this component holds in state is ever sent as
 * the source of truth for the created profile, only `installationId` +
 * `gameDir` + `name` are.
 */
export function ImportProfileDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  /** The full, updated profile list, per the config module's create contract - same shape `CreateProfileDialog` uses, since `ConfigView` passes it the same `handleCreated`. */
  onCreated: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)

  const [installationId, setInstallationId] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<Outcome<{
    candidates: ImportGamedirCandidate[]
  }> | null>(null)

  const [gameDir, setGameDir] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<Outcome<ImportPreviewResult> | null>(null)

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [commitError, setCommitError] = useState<Outcome<ConfigProfile[]> | null>(null)

  const installation = installations.find((entry) => entry.id === installationId) ?? null
  const candidates = scanResult?.ok ? scanResult.value.candidates : []

  // Scan the chosen installation for importable gamedirs. Re-runs whenever the
  // installation changes; picking a new installation resets the gamedir and
  // preview state below it, since neither is valid for the new installation.
  useEffect(() => {
    setGameDir('')
    setPreviewResult(null)
    if (!installationId) {
      setScanResult(null)
      return
    }
    let cancelled = false
    setScanning(true)
    setScanResult(null)
    void scanImportCandidates({ installationId }).then((result) => {
      if (cancelled) return
      setScanning(false)
      setScanResult(result)
      if (result.ok && result.value.candidates.length > 0) {
        setGameDir(result.value.candidates[0].gameDir)
      }
    })
    return () => {
      cancelled = true
    }
  }, [installationId])

  // Preview the chosen gamedir once both installation and gamedir are known.
  useEffect(() => {
    if (!installationId || !gameDir) {
      setPreviewResult(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    setPreviewResult(null)
    void previewImportCandidates({ installationId, gameDir }).then((result) => {
      if (cancelled) return
      setPreviewing(false)
      setPreviewResult(result)
    })
    return () => {
      cancelled = true
    }
  }, [installationId, gameDir])

  // Prefill the name from the chosen installation (decision 16), but only
  // while the user has not typed their own - switching installation/gamedir
  // after a manual edit must never clobber it.
  useEffect(() => {
    if (nameTouched || !installation) return
    setName(t('config.importDialog.namePrefill', { name: installation.name }))
  }, [installation, nameTouched, t])

  const canSubmit =
    installationId.length > 0 && gameDir.length > 0 && name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setCommitError(null)
    const result = await commitImportProfile({ installationId, gameDir, name: name.trim() })
    setSubmitting(false)
    if (result.ok) {
      onCreated(result.value)
    } else {
      setCommitError(result)
    }
  }

  return (
    <Modal
      open
      size="md"
      title={t('config.importDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.importDialog.submit')}
          </Button>
        </>
      }
    >
      {installations.length === 0 ? (
        <EmptyState
          title={t('config.importDialog.noInstallations.title')}
          body={t('config.importDialog.noInstallations.body')}
        />
      ) : (
        <div className="space-y-4">
          <Field label={t('config.importDialog.installationLabel')}>
            <Select
              value={installationId}
              onChange={(event) => {
                setInstallationId(event.target.value)
              }}
              options={[
                {
                  value: '',
                  label: t('config.importDialog.installationPlaceholder'),
                  disabled: true,
                },
                ...installations.map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
            />
          </Field>

          {scanning && (
            <div className="flex items-center justify-center py-6">
              <Spinner />
            </div>
          )}

          {!scanning && scanResult && !scanResult.ok && (
            <p className="text-xs text-danger">
              {t(scanResult.error.key, scanResult.error.params)}
            </p>
          )}

          {!scanning && scanResult?.ok && candidates.length === 0 && (
            <EmptyState
              title={t('config.importDialog.noConfigFiles.title')}
              body={t('config.importDialog.noConfigFiles.body')}
            />
          )}

          {!scanning && candidates.length > 0 && (
            <>
              <Field label={t('config.importDialog.gameDirLabel')}>
                <Select
                  value={gameDir}
                  onChange={(event) => setGameDir(event.target.value)}
                  options={candidates.map((candidate) => ({
                    value: candidate.gameDir,
                    label: candidate.gameDir,
                  }))}
                />
              </Field>

              {previewing && (
                <div className="flex items-center justify-center py-6">
                  <Spinner />
                </div>
              )}

              {!previewing && previewResult && !previewResult.ok && (
                <p className="text-xs text-danger">
                  {t(previewResult.error.key, previewResult.error.params)}
                </p>
              )}

              {!previewing && previewResult?.ok && (
                <div className="space-y-3">
                  <div className="space-y-1.5 rounded-sm border border-line p-2.5">
                    <KeyValue label={t('config.importDialog.cvarCount')}>
                      {previewResult.value.cvarCount}
                    </KeyValue>
                    <KeyValue label={t('config.importDialog.bindCount')}>
                      {previewResult.value.bindCount}
                    </KeyValue>
                  </div>

                  {previewResult.value.preserved.length > 0 && (
                    <div className="space-y-1.5">
                      <SectionLabel>
                        {t('config.importDialog.preservedCount', {
                          count: previewResult.value.preserved.length,
                        })}
                      </SectionLabel>
                      <ul className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-line p-2">
                        {previewResult.value.preserved.map((line, index) => (
                          <li
                            key={`${line.file}:${line.line}:${index}`}
                            className="flex min-w-0 items-baseline gap-2 text-xs"
                          >
                            <span className="numeric shrink-0 text-ink-muted">
                              {line.file}:{line.line}
                            </span>
                            <code className="min-w-0 truncate text-ink-dim" title={line.text}>
                              {line.text}
                            </code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <Field label={t('config.importDialog.nameLabel')}>
                <Input
                  value={name}
                  placeholder={t('config.importDialog.namePlaceholder')}
                  onChange={(event) => {
                    setNameTouched(true)
                    setName(event.target.value)
                  }}
                  maxLength={120}
                />
              </Field>
            </>
          )}

          {commitError && !commitError.ok && (
            <p className="text-xs text-danger">
              {t(commitError.error.key, commitError.error.params)}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
