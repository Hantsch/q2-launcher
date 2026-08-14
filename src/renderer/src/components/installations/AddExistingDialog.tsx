import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { engineLabel, type ValidationResult } from '@shared/types'
import { cn } from '../../lib/cn'
import { invoke } from '../../lib/bridge'
import { useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Field, Input, PathPicker, Select } from '../ui/controls'
import { Badge, Spinner } from '../ui/primitives'
import { Modal } from '../ui/Modal'

/**
 * Add an installation that already exists on disk.
 *
 * The folder is inspected as soon as it is chosen and the verdict is shown before
 * anything is saved, so the user finds out about a missing pak0.pak here rather
 * than when they press Play.
 */
export function AddExistingDialog() {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)
  const addExisting = useLauncher((state) => state.addExisting)

  const [rootPath, setRootPath] = useState('')
  const [name, setName] = useState('')
  const [executablePath, setExecutablePath] = useState('')
  const [inspection, setInspection] = useState<ValidationResult | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const pickFolder = async (): Promise<void> => {
    const picked = await invoke('installations:pickFolder', {
      title: t('dialog.addExisting.pickTitle'),
      buttonLabel: t('dialog.addExisting.pickButton'),
    })
    if (!picked) return

    setRootPath(picked)
    setInspecting(true)
    setInspection(null)

    const result = await invoke('installations:inspectPath', picked)
    setInspecting(false)
    if (!result.ok) return

    setInspection(result.value)
    setExecutablePath(result.value.executables[0] ?? '')
    // Pre-fill a sensible name, but let the user override it.
    const folder = picked.split(/[\\/]/).filter(Boolean).pop() ?? 'Quake II'
    setName(
      result.value.engineKind === 'unknown'
        ? folder
        : `${engineLabel(result.value.engineKind)} - ${folder}`,
    )
  }

  /**
   * Only an outright "this is not Quake II" blocks adding. A folder that has
   * baseq2 but is missing pak files is still worth registering - the user then
   * sees it in their library with an actionable fix, which beats being told no.
   */
  const notQuake2 =
    inspection !== null &&
    inspection.engineKind === 'unknown' &&
    inspection.checks.some((check) => check.id === 'base-game-dir' && check.severity === 'error')

  const canSubmit =
    rootPath.length > 0 && inspection !== null && !notQuake2 && !inspecting && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const result = await addExisting({
      rootPath,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(executablePath ? { executablePath } : {}),
    })
    setSubmitting(false)
    if (result.ok) closeDialog()
  }

  return (
    <Modal
      open
      title={t('dialog.addExisting.title')}
      description={t('dialog.addExisting.body')}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('dialog.addExisting.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('dialog.addExisting.folderLabel')}>
          <PathPicker
            value={rootPath}
            placeholder={t('dialog.addExisting.folderPlaceholder')}
            onBrowse={() => void pickFolder()}
            browseLabel={t('common.browse')}
            disabled={inspecting || submitting}
          />
        </Field>

        {inspecting && (
          <div className="flex items-center gap-2 text-xs text-ink-dim">
            <Spinner />
            {t('dialog.addExisting.inspecting')}
          </div>
        )}

        {inspection && (
          <>
            <div className="space-y-2 rounded-md border border-line bg-void/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="stencil">{t('dialog.addExisting.detected')}</span>
                <Badge tone={inspection.engineKind === 'r1q2' ? 'flame' : 'neutral'}>
                  {engineLabel(inspection.engineKind)}
                </Badge>
                {inspection.gameDirs.map((dir) => (
                  <Badge key={dir} tone="strogg">
                    {dir}
                  </Badge>
                ))}
              </div>

              <ul className="space-y-1.5">
                {inspection.checks.length === 0 ? (
                  <li className="flex items-center gap-2 text-xs text-success">
                    <CircleCheck className="size-3.5" />
                    {t('validation.allGood')}
                  </li>
                ) : (
                  inspection.checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-2">
                      {check.severity === 'error' ? (
                        <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" />
                      ) : (
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
                      )}
                      <span
                        className={cn(
                          'text-xs leading-relaxed',
                          check.severity === 'error' ? 'text-danger' : 'text-ink-dim',
                        )}
                      >
                        {t(check.messageKey, check.params ?? {})}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            {inspection.executables.length > 1 && (
              <Field
                label={t('dialog.addExisting.executableLabel')}
                hint={t('dialog.addExisting.executableHint')}
              >
                <Select
                  value={executablePath}
                  onChange={(event) => setExecutablePath(event.target.value)}
                  options={inspection.executables.map((path) => ({
                    value: path,
                    label: path.split(/[\\/]/).pop() ?? path,
                  }))}
                />
              </Field>
            )}

            <Field label={t('dialog.addExisting.nameLabel')}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
              />
            </Field>

            {notQuake2 && (
              <p className="stripes-danger rounded-sm border border-danger/35 p-2.5 text-xs leading-relaxed text-ink-dim">
                {t('installations.error.notQuake2', { path: rootPath })}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
