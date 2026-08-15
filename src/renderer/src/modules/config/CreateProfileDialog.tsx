import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile, ConfigProfileSeed } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { createConfigProfile } from './client'

/**
 * The "Start from" choice this dialog offers. `ConfigProfileSeed` (shared, and
 * also spent on the real `create` IPC call's `from` field) only ever knows
 * `'empty' | 'template'` - importing is a whole separate flow with its own
 * multi-step dialog (`ImportProfileDialog`) and never goes through `create`,
 * so `'import'` is added here, renderer-local, rather than widening the shared
 * type for a value main would never accept.
 */
type ProfileSource = ConfigProfileSeed | 'import'

/**
 * Creates a config profile, empty, seeded from the standard template, or - by
 * handing off to `ImportProfileDialog` - imported from an installation's
 * existing config files (story 005, decision 10: import is a fourth "Start
 * from" option here, not a separate screen).
 *
 * Module-local, like the rest of the config module's dialogs: it owns its own
 * form state and talks to the config client directly, rather than going through
 * the shell's dialog/store mechanism (that mechanism is for shell-level, i.e.
 * installation, dialogs).
 */
export function CreateProfileDialog({
  onClose,
  onCreated,
  onWantImport,
}: {
  onClose: () => void
  /** The full, updated profile list, per the config module's create contract. */
  onCreated: (profiles: ConfigProfile[]) => void
  /**
   * Called instead of `onCreated`, on submit, when `from === 'import'`: this
   * dialog never calls `createConfigProfile` for that case. `ConfigView` wires
   * this to close this dialog and open `ImportProfileDialog`, which has room
   * for the installation → gamedir → preview steps a single small form can't
   * hold.
   */
  onWantImport: () => void
}) {
  const { t } = useTranslation()

  const [name, setName] = useState('')
  const [from, setFrom] = useState<ProfileSource>('empty')
  const [submitting, setSubmitting] = useState(false)

  const isImport = from === 'import'
  const canSubmit = (isImport || name.trim().length > 0) && !submitting

  const submit = async (): Promise<void> => {
    if (from === 'import') {
      onWantImport()
      return
    }
    setSubmitting(true)
    const result = await createConfigProfile({ name: name.trim(), from })
    setSubmitting(false)
    if (result.ok) onCreated(result.value)
  }

  return (
    <Modal
      open
      title={t('config.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {isImport ? t('config.createDialog.continue') : t('config.createDialog.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('config.createDialog.sourceLabel')}>
          <Select
            value={from}
            onChange={(event) => setFrom(event.target.value as ProfileSource)}
            options={[
              { value: 'empty', label: t('config.createDialog.sourceEmpty') },
              { value: 'template', label: t('config.createDialog.sourceTemplate') },
              { value: 'import', label: t('config.createDialog.sourceImport') },
            ]}
          />
        </Field>

        {!isImport && (
          <Field label={t('config.createDialog.nameLabel')}>
            <Input
              value={name}
              placeholder={t('config.createDialog.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
          </Field>
        )}
      </div>
    </Modal>
  )
}
