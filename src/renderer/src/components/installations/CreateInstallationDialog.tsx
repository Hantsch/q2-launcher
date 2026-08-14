import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { ENGINE_DEFINITIONS, type EngineKind } from '@shared/types'
import { invoke } from '../../lib/bridge'
import { useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Field, Input, PathPicker, Select } from '../ui/controls'
import { Modal } from '../ui/Modal'

/**
 * Set up a fresh installation folder.
 *
 * Downloading the game files belongs to the install module, which does not exist
 * yet - so this flow deliberately stops one step short and says so. The result is
 * a real entry in the library that reports "game files missing" with a fix
 * action, rather than a button that leads nowhere.
 */
export function CreateInstallationDialog() {
  const { t } = useTranslation()
  const closeDialog = useLauncher((state) => state.closeDialog)
  const createInstallation = useLauncher((state) => state.createInstallation)

  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [engineKind, setEngineKind] = useState<EngineKind>('r1q2')
  const [submitting, setSubmitting] = useState(false)

  const pickFolder = async (): Promise<void> => {
    const picked = await invoke('installations:pickFolder', {
      title: t('dialog.create.pickTitle'),
      buttonLabel: t('dialog.create.pickButton'),
    })
    if (!picked) return
    setRootPath(picked)
    if (name.trim().length === 0) {
      setName(picked.split(/[\\/]/).filter(Boolean).pop() ?? 'Quake II')
    }
  }

  const canSubmit = name.trim().length > 0 && rootPath.length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const result = await createInstallation({ name: name.trim(), rootPath, engineKind })
    setSubmitting(false)
    if (result.ok) closeDialog()
  }

  return (
    <Modal
      open
      title={t('dialog.create.title')}
      description={t('dialog.create.body')}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('dialog.create.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('dialog.create.locationLabel')}>
          <PathPicker
            value={rootPath}
            onBrowse={() => void pickFolder()}
            browseLabel={t('common.browse')}
            disabled={submitting}
          />
        </Field>

        <Field label={t('dialog.create.nameLabel')}>
          <Input
            value={name}
            placeholder={t('dialog.create.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
          />
        </Field>

        <Field label={t('dialog.create.engineLabel')}>
          <Select
            value={engineKind}
            onChange={(event) => setEngineKind(event.target.value as EngineKind)}
            options={ENGINE_DEFINITIONS.map((definition) => ({
              value: definition.kind,
              label: definition.label,
            }))}
          />
        </Field>

        <p className="flex items-start gap-2 rounded-sm border border-line-strong bg-void/40 p-2.5 text-xs leading-relaxed text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-flame-500" />
          {t('dialog.create.notice')}
        </p>
      </div>
    </Modal>
  )
}
