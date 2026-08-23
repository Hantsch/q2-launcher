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
import { ConfigCodeView } from './components/ConfigCodeView'

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
  profiles,
  onClose,
  onCreated,
}: {
  /**
   * Story 042 (D6): the locally registered profiles, so a launcher-written file's
   * `sourceProfileId` (`ImportPreviewResult`) can be resolved to a name when that profile still
   * exists here - `ConfigView` already holds this list for the profile rail, passed straight
   * through rather than this dialog re-fetching it.
   */
  profiles: ConfigProfile[]
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

  // Story 041 (D7): per-alias-name choice for the review step - `true` means "attempt as
  // layer", absent/`false` means the default, "import as plain alias". Keyed by name rather
  // than by array index so a re-run of the preview effect (installation/gameDir change) can
  // simply reset this to `{}` alongside `previewResult` without an index ever going stale.
  const [layerChoices, setLayerChoices] = useState<Record<string, boolean>>({})

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [commitError, setCommitError] = useState<Outcome<ConfigProfile[]> | null>(null)

  const installation = installations.find((entry) => entry.id === installationId) ?? null
  const candidates = scanResult?.ok ? scanResult.value.candidates : []
  // The review step's own rows (story 041 D7) - empty whenever the preview has nothing
  // ambiguous, which is also what makes the step disappear entirely rather than render empty.
  const ambiguousAliases = previewResult?.ok ? previewResult.value.ambiguousRebindAliases : []
  // Story 042 (D6): the file's own sentinel names a profile id, never adopted (AC4) but resolved
  // to a name when that profile is still registered locally - `undefined` when `sourceProfileId`
  // is null (a foreign config) or names a profile this launcher no longer knows about.
  const sourceProfileName = previewResult?.ok
    ? profiles.find((profile) => profile.id === previewResult.value.sourceProfileId)?.name
    : undefined

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
    setLayerChoices({})
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
    // Story 041 (D7): only the names the user actually flipped to "attempt as layer" travel
    // to commit - everything else defaults to a plain alias by simply not being in this list.
    const layerAliases = ambiguousAliases
      .filter((alias) => layerChoices[alias.name])
      .map((alias) => alias.name)
    const result = await commitImportProfile({
      installationId,
      gameDir,
      name: name.trim(),
      layerAliases,
    })
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
              data-testid="config-import-installation"
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
                  data-testid="config-import-gamedir"
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
                  {/* Story 042 (D6): a launcher-written file reads as a restore, not a
                      best-effort import - and always says a NEW profile is created, since the
                      id is never adopted (AC4) and a user restoring their own profile on a new
                      machine could otherwise assume this merges into/overwrites it. */}
                  {previewResult.value.ownWrittenFile && (
                    <div
                      className="space-y-1 rounded-sm border border-line p-2.5 text-xs"
                      data-testid="config-import-restore-banner"
                    >
                      <p className="font-medium text-ink">
                        {t('config.importDialog.restore.title')}
                      </p>
                      <p className="leading-relaxed text-ink-muted">
                        {sourceProfileName
                          ? t('config.importDialog.restore.bodyNamed', { name: sourceProfileName })
                          : t('config.importDialog.restore.bodyUnnamed', {
                              id: previewResult.value.sourceProfileId ?? '',
                            })}
                      </p>
                    </div>
                  )}

                  <div className="space-y-1.5 rounded-sm border border-line p-2.5">
                    <KeyValue label={t('config.importDialog.cvarCount')}>
                      {previewResult.value.cvarCount}
                    </KeyValue>
                    <KeyValue label={t('config.importDialog.bindCount')}>
                      {previewResult.value.bindCount}
                    </KeyValue>
                    <KeyValue label={t('config.importDialog.aliasCount')}>
                      {previewResult.value.aliasCount}
                    </KeyValue>
                    <KeyValue label={t('config.importDialog.messageCount')}>
                      {previewResult.value.messageCount}
                    </KeyValue>
                  </div>

                  {previewResult.value.duplicateBinds.length > 0 && (
                    <div className="space-y-1.5">
                      <SectionLabel>
                        {t('config.importDialog.duplicateBindCount', {
                          count: previewResult.value.duplicateBinds.length,
                        })}
                      </SectionLabel>
                      <ul
                        tabIndex={0}
                        aria-label={t('config.importDialog.duplicateBindCount', {
                          count: previewResult.value.duplicateBinds.length,
                        })}
                        className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-danger/35 bg-danger/8 p-2"
                      >
                        {previewResult.value.duplicateBinds.map((duplicate, index) => (
                          <li
                            key={`${duplicate.key}:${duplicate.file}:${duplicate.line}:${index}`}
                            className="flex min-w-0 items-baseline gap-2 text-xs text-danger"
                          >
                            <span className="numeric shrink-0 text-ink-muted">
                              {duplicate.file}:{duplicate.line}
                            </span>
                            <div title={duplicate.key} className="min-w-0 overflow-hidden">
                              <ConfigCodeView text={duplicate.key} singleLine />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {previewResult.value.duplicateAliases.length > 0 && (
                    <div className="space-y-1.5">
                      <SectionLabel>
                        {t('config.importDialog.duplicateAliasCount', {
                          count: previewResult.value.duplicateAliases.length,
                        })}
                      </SectionLabel>
                      <ul
                        tabIndex={0}
                        aria-label={t('config.importDialog.duplicateAliasCount', {
                          count: previewResult.value.duplicateAliases.length,
                        })}
                        className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-danger/35 bg-danger/8 p-2"
                      >
                        {previewResult.value.duplicateAliases.map((duplicate, index) => (
                          <li
                            key={`${duplicate.name}:${duplicate.file}:${duplicate.line}:${index}`}
                            className="flex min-w-0 items-baseline gap-2 text-xs text-danger"
                          >
                            <span className="numeric shrink-0 text-ink-muted">
                              {duplicate.file}:{duplicate.line}
                            </span>
                            <div title={duplicate.name} className="min-w-0 overflow-hidden">
                              <ConfigCodeView text={duplicate.name} singleLine />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {previewResult.value.preserved.length > 0 && (
                    <div className="space-y-1.5">
                      <SectionLabel>
                        {t('config.importDialog.preservedCount', {
                          count: previewResult.value.preserved.length,
                        })}
                      </SectionLabel>
                      <ul
                        tabIndex={0}
                        aria-label={t('config.importDialog.preservedCount', {
                          count: previewResult.value.preserved.length,
                        })}
                        className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-line p-2"
                      >
                        {previewResult.value.preserved.map((line, index) => (
                          <li
                            key={`${line.file}:${line.line}:${index}`}
                            className="flex min-w-0 items-baseline gap-2 text-xs"
                          >
                            <span className="numeric shrink-0 text-ink-muted">
                              {line.file}:{line.line}
                            </span>
                            <div title={line.text} className="min-w-0 overflow-hidden">
                              <ConfigCodeView text={line.text} singleLine />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Story 042 (D6): every discrepancy `restoreProfileParts` found between a
                      launcher-written file's metadata and its config lines - each entry's own
                      i18n key already ends in a translated "(file:line)" locator, interpolated
                      by `t()`, not built by string concatenation here. Empty renders nothing,
                      same convention as `preserved`/`duplicateBinds` above. */}
                  {previewResult.value.metadataWarnings.length > 0 && (
                    <div className="space-y-1.5">
                      <SectionLabel>
                        {t('config.importDialog.metadataWarningCount', {
                          count: previewResult.value.metadataWarnings.length,
                        })}
                      </SectionLabel>
                      <ul
                        tabIndex={0}
                        aria-label={t('config.importDialog.metadataWarningCount', {
                          count: previewResult.value.metadataWarnings.length,
                        })}
                        className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-line p-2"
                      >
                        {previewResult.value.metadataWarnings.map((warning, index) => (
                          <li
                            key={`${warning.key}:${warning.file}:${warning.line}:${index}`}
                            className="text-xs leading-relaxed text-ink-muted"
                          >
                            {t(warning.key, {
                              file: warning.file,
                              line: warning.line,
                              subject: warning.subject ?? '',
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Story 041 (D7): the review step, between preview and name. Present only when
                  `ambiguousRebindAliases` is non-empty - `ambiguousAliases` is already `[]`
                  whenever the preview has nothing ambiguous, so there is no separate "skip"
                  branch to keep in sync with this one; the condition alone is the skip. */}
              {ambiguousAliases.length > 0 && (
                <div className="space-y-1.5" data-testid="config-import-review">
                  <SectionLabel>
                    {t('config.importDialog.review.count', { count: ambiguousAliases.length })}
                  </SectionLabel>
                  <p className="text-xs leading-relaxed text-ink-muted">
                    {t('config.importDialog.review.hint')}
                  </p>
                  <ul className="space-y-2">
                    {ambiguousAliases.map((alias, index) => {
                      const groupName = `config-import-review-${index}`
                      const attemptAsLayer = layerChoices[alias.name] === true
                      return (
                        <li
                          key={`${alias.name}:${alias.file}:${alias.line}:${index}`}
                          data-testid="config-import-review-row"
                          className="space-y-1.5 rounded-sm border border-line p-2.5"
                        >
                          <div className="flex min-w-0 items-baseline gap-2 text-xs">
                            <span className="numeric shrink-0 text-ink-muted">
                              {alias.file}:{alias.line}
                            </span>
                            <div title={alias.name} className="min-w-0 overflow-hidden font-medium text-ink">
                              {alias.name}
                            </div>
                          </div>
                          <ConfigCodeView text={alias.body} singleLine />
                          <div className="flex flex-wrap items-center gap-4 text-xs text-ink">
                            <label className="flex cursor-pointer items-center gap-1.5">
                              <input
                                type="radio"
                                name={groupName}
                                className="accent-flame-500"
                                checked={!attemptAsLayer}
                                onChange={() =>
                                  setLayerChoices((prev) => ({ ...prev, [alias.name]: false }))
                                }
                              />
                              {t('config.importDialog.review.plainAlias')}
                            </label>
                            <label className="flex cursor-pointer items-center gap-1.5">
                              <input
                                type="radio"
                                name={groupName}
                                className="accent-flame-500"
                                checked={attemptAsLayer}
                                onChange={() =>
                                  setLayerChoices((prev) => ({ ...prev, [alias.name]: true }))
                                }
                              />
                              {t('config.importDialog.review.attemptAsLayer')}
                            </label>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
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
