import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { QuickFiltersResult } from '@shared/modules/servers'
import { validateQuickFilterName, type QuickFilter } from '@shared/servers/quick-filters'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'

/**
 * Story 197 D3: asks for a quick filter's name - to save the current filter (default) or, with
 * `renameId`, to rename an existing one (no overwrite offer; D4). Live validation reuses the pure
 * `validateQuickFilterName`; a `taken` name additionally offers *Overwrite* (save mode only), and a
 * refusal from main shows its reason key in the very same error slot.
 */
export function QuickFilterNameDialog({
  list,
  initialName = '',
  renameId,
  onSubmit,
  onClose,
}: {
  list: readonly QuickFilter[]
  initialName?: string
  renameId?: string
  onSubmit: (name: string, overwrite: boolean) => Promise<QuickFiltersResult>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const problem = validateQuickFilterName(name, list, renameId)
  const unchanged = renameId !== undefined && name.trim() === initialName.trim()
  const localError = problem && name !== '' ? t(`servers.quickFilter.error.${problem}`) : undefined
  const refusalError = refusal ? t(refusal) : undefined
  const error = localError ?? refusalError
  const canSubmit = problem === null && !unchanged && !submitting
  const canOverwrite = renameId === undefined && problem === 'taken' && !submitting

  const submit = async (overwrite: boolean): Promise<void> => {
    if (!(overwrite ? canOverwrite : canSubmit)) return
    setSubmitting(true)
    const result = await onSubmit(name.trim(), overwrite)
    setSubmitting(false)
    if (result.ok) onClose()
    else setRefusal(result.reasonKey)
  }

  return (
    <Modal
      open
      size="sm"
      title={t(renameId ? 'servers.quickFilter.dialog.renameTitle' : 'servers.quickFilter.dialog.saveTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {canOverwrite && (
            <Button
              variant="neutral"
              onClick={() => void submit(true)}
              data-testid="servers-quickfilter-overwrite"
            >
              {t('servers.quickFilter.dialog.overwrite')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={() => void submit(false)}
            data-testid="servers-quickfilter-dialog-save"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div data-testid="servers-quickfilter-dialog">
        <Field label={t('servers.quickFilter.dialog.label')} error={error}>
          <Input
            value={name}
            autoFocus
            data-testid="servers-quickfilter-name"
            onChange={(event) => {
              setName(event.target.value)
              setRefusal(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit(false)
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}
