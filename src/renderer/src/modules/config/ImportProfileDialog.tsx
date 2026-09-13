import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, FolderOpen, Trash2 } from 'lucide-react'
import type { ConfigProfile, ImportPreviewResult, PickedConfigFile } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Button, IconButton } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { EmptyState, KeyValue, SectionLabel, Spinner } from '../../components/ui/primitives'
import { commitImportFiles, pickImportFiles, previewImportFiles } from './client'
import { ConfigCodeView } from './components/ConfigCodeView'

/**
 * Imports the user's own, hand-picked config files into a new profile (story 005; re-addressed by
 * story 066 D7 from `{ installationId, gameDir }` to a file picker).
 *
 * Reached from `CreateProfileDialog` via its "Start from -> Import" option, exactly as before this
 * deliverable - `ConfigView` swaps that dialog for this one on `onWantImport`, and this component's
 * own props (`profiles`/`onClose`/`onCreated`) are unchanged.
 *
 * **Path trust** (CLAUDE.md): this component never holds, observes or composes an absolute path.
 * `pickImportFiles()` returns opaque `PickedConfigFile` handles (`id` + display-only
 * `fileName`/`dirName` - see that type's own doc comment in `@shared/modules/config`), and every
 * call this dialog makes afterwards - `previewImportFiles`/`commitImportFiles` - is addressed
 * entirely by those ids, in the order the user arranged them (AC5, the load order). There is no
 * path field anywhere in this file's state to audit away; there simply is no path to hold.
 *
 * Read-only until Create is pressed, same as before: `previewImportFiles` never writes anything
 * (decision 14), and `commitImportFiles` re-reads and re-parses the picked files from disk itself
 * rather than trusting anything previewed here (decision 3) - so nothing this component holds in
 * state is ever sent as the source of truth for the created profile, only the ordered `fileIds` +
 * `name` are.
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

  // The ordered list of picked files - its order IS the load order (AC5): `fileIds` sent to
  // preview/commit is always `files.map((file) => file.id)`, nothing reorders or dedupes it apart
  // from what `choose`/`moveFile`/`removeFile` below do explicitly.
  const [files, setFiles] = useState<PickedConfigFile[]>([])
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<Outcome<PickedConfigFile[]> | null>(null)

  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<Outcome<ImportPreviewResult> | null>(null)

  // Story 041 (D7): per-alias-name choice for the review step - `true` means "attempt as
  // layer", absent/`false` means the default, "import as plain alias". Keyed by name rather
  // than by array index so a re-run of the preview effect (an order change) can simply reset
  // this to `{}` alongside `previewResult` without an index ever going stale.
  const [layerChoices, setLayerChoices] = useState<Record<string, boolean>>({})

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [commitError, setCommitError] = useState<Outcome<ConfigProfile[]> | null>(null)

  // The review step's own rows (story 041 D7) - empty whenever the preview has nothing
  // ambiguous, which is also what makes the step disappear entirely rather than render empty.
  const ambiguousAliases = previewResult?.ok ? previewResult.value.ambiguousRebindAliases : []
  // Story 042 (D6): the file's own sentinel names a profile id, never adopted (AC4) but resolved
  // to a name when that profile is still registered locally - `undefined` when `sourceProfileId`
  // is null (a foreign config) or names a profile this launcher no longer knows about.
  const sourceProfileName = previewResult?.ok
    ? profiles.find((profile) => profile.id === previewResult.value.sourceProfileId)?.name
    : undefined

  // Preview re-runs on every order change - add, remove or move (AC5). `files` is only ever
  // replaced wholesale by `choose`/`moveFile`/`removeFile` below, never mutated in place, so this
  // effect fires on exactly those changes.
  useEffect(() => {
    const fileIds = files.map((file) => file.id)
    if (fileIds.length === 0) {
      setPreviewResult(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    setPreviewResult(null)
    setLayerChoices({})
    void previewImportFiles({ fileIds }).then((result) => {
      if (cancelled) return
      setPreviewing(false)
      setPreviewResult(result)
    })
    return () => {
      cancelled = true
    }
  }, [files])

  // Prefill the name from the first picked file (same "prefill until the user types their own"
  // precedent the old installation-addressed dialog followed), stripping the extension so
  // "config.cfg" prefills as "config (imported)" rather than carrying it verbatim.
  useEffect(() => {
    if (nameTouched) return
    const first = files[0]
    if (!first) return
    setName(t('config.importDialog.namePrefill', { name: first.fileName.replace(/\.cfg$/i, '') }))
  }, [files, nameTouched, t])

  const canSubmit = files.length > 0 && name.trim().length > 0 && !submitting

  const choose = async (): Promise<void> => {
    setPicking(true)
    setPickError(null)
    const result = await pickImportFiles()
    setPicking(false)
    if (!result.ok) {
      setPickError(result)
      return
    }
    // Appends rather than replaces - a user may pick in more than one round. Dedupe by id in case
    // the same handle somehow comes back twice; two picks of the same on-disk file each get their
    // own id from the registry (`picked-files.ts`), so this is a defensive no-op in practice, not
    // the mechanism the story relies on.
    setFiles((prev) => {
      const known = new Set(prev.map((file) => file.id))
      const additions = result.value.filter((file) => !known.has(file.id))
      return [...prev, ...additions]
    })
  }

  const moveFile = (index: number, direction: -1 | 1): void => {
    setFiles((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const moved = next[index]
      const displaced = next[target]
      if (!moved || !displaced) return prev
      next[index] = displaced
      next[target] = moved
      return next
    })
  }

  const removeFile = (id: string): void => {
    setFiles((prev) => prev.filter((file) => file.id !== id))
  }

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setCommitError(null)
    // Story 041 (D7): only the names the user actually flipped to "attempt as layer" travel
    // to commit - everything else defaults to a plain alias by simply not being in this list.
    const layerAliases = ambiguousAliases
      .filter((alias) => layerChoices[alias.name])
      .map((alias) => alias.name)
    const result = await commitImportFiles({
      fileIds: files.map((file) => file.id),
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
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t('config.importDialog.filesLabel')}</SectionLabel>
          <Button
            size="sm"
            icon={<FolderOpen className="size-3.5" />}
            disabled={picking}
            onClick={() => void choose()}
          >
            {t('config.importDialog.chooseFiles')}
          </Button>
        </div>

        {pickError && !pickError.ok && (
          <p className="text-xs text-danger">{t(pickError.error.key, pickError.error.params)}</p>
        )}

        {files.length === 0 ? (
          <EmptyState
            title={t('config.importDialog.noFilesPicked.title')}
            body={t('config.importDialog.noFilesPicked.body')}
          />
        ) : (
          <ul className="space-y-1.5" data-testid="config-import-file-list">
            {files.map((file, index) => (
              <li
                key={file.id}
                data-testid="config-import-file-row"
                className="flex items-center gap-2 rounded-sm border border-line p-2"
              >
                <div className="min-w-0 flex-1">
                  <p title={file.fileName} className="truncate text-xs font-medium text-ink">
                    {file.fileName}
                  </p>
                  <p title={file.dirName} className="truncate text-[11px] text-ink-muted">
                    {file.dirName}
                  </p>
                </div>
                <IconButton
                  label={t('config.importDialog.files.moveUp')}
                  size="sm"
                  disabled={index === 0}
                  onClick={() => moveFile(index, -1)}
                >
                  <ArrowUp className="size-3.5" />
                </IconButton>
                <IconButton
                  label={t('config.importDialog.files.moveDown')}
                  size="sm"
                  disabled={index === files.length - 1}
                  onClick={() => moveFile(index, 1)}
                >
                  <ArrowDown className="size-3.5" />
                </IconButton>
                <IconButton
                  label={t('config.importDialog.files.remove')}
                  size="sm"
                  variant="danger"
                  onClick={() => removeFile(file.id)}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <>
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
    </Modal>
  )
}
