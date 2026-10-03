import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile, ConfigProfileSeed } from '@shared/modules/config'
import { NameDialog } from '../../components/ui/NameDialog'
import { Field, Select } from '../../components/ui/controls'
import { createConfigProfile } from './client'

/**
 * The "Start from" choice this dialog offers. `ConfigProfileSeed` (shared, and
 * also spent on the real `create` IPC call's `from` field) only ever knows
 * `'empty' | 'template-right' | 'template-left'` - importing is a whole
 * separate flow with its own multi-step dialog (`ImportProfileDialog`) and
 * never goes through `create`, so `'import'` is added here, renderer-local,
 * rather than widening the shared type for a value main would never accept.
 */
type ProfileSource = ConfigProfileSeed | 'import'

/**
 * Creates a config profile: empty, seeded from the standard template in
 * either handedness, or - by handing off to `ImportProfileDialog` - imported
 * from an installation's existing config files (import is a fourth "Start
 * from" option here, not a separate screen).
 *
 * Both template choices seed byte-for-byte identical content today
 * (`STANDARD_TEMPLATE`, main-side `ProfilesStore.create`), which is what
 * `templateHandednessNote`'s caption says outright.
 *
 * Module-local, like the rest of the config module's dialogs: it talks to the
 * config client directly, rather than going through the shell's dialog/store
 * mechanism (that mechanism is for shell-level, i.e. installation, dialogs).
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
  const [from, setFrom] = useState<ProfileSource>('empty')

  const isImport = from === 'import'
  const isTemplate = from === 'template-right' || from === 'template-left'

  return (
    <NameDialog
      titleKey="config.createDialog.title"
      labelKey="config.createDialog.nameLabel"
      initialName=""
      maxLength={120}
      placeholder={t('config.createDialog.namePlaceholder')}
      nameOptional={isImport}
      submitLabelKey={isImport ? 'config.createDialog.continue' : 'config.createDialog.submit'}
      testIds={{ submit: 'config-create-submit' }}
      onClose={onClose}
      onSubmit={async (name) => {
        if (from === 'import') {
          onWantImport()
          return
        }
        const result = await createConfigProfile({ name, from })
        if (result.ok) onCreated(result.value)
      }}
    >
      <Field
        label={t('config.createDialog.sourceLabel')}
        hint={isTemplate ? t('config.createDialog.templateHandednessNote') : undefined}
      >
        <Select
          data-testid="config-create-source"
          value={from}
          onChange={(event) => setFrom(event.target.value as ProfileSource)}
          options={[
            { value: 'empty', label: t('config.createDialog.sourceEmpty') },
            { value: 'template-right', label: t('config.createDialog.sourceTemplateRight') },
            { value: 'template-left', label: t('config.createDialog.sourceTemplateLeft') },
            { value: 'import', label: t('config.createDialog.sourceImport') },
          ]}
        />
      </Field>
    </NameDialog>
  )
}
