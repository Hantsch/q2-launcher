import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ShieldCheck, TriangleAlert } from 'lucide-react'
import { isStoreManaged } from '@shared/types'
import { cn } from '../../lib/cn'
import { useInstallationById, useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

type RemovalChoice = 'entry-only' | 'delete-from-disk'

/**
 * Removal chooser (story 094 D3).
 *
 * Step 1 (D1/D2, already merged): main can delete an installation's folder from disk when asked
 * to, refusing for a store-managed installation or while its game is running. This dialog is the
 * renderer half of that contract - it decides whether the choice exists at all, and if it does,
 * makes sure the user sees the exact folder before anything is deleted.
 *
 * A store-managed installation (`isStoreManaged`) only ever gets entry-only removal: deleting its
 * folder behind the store's back would leave the store convinced the game is still installed. The
 * disk option is not rendered at all for it - not hidden, not disabled - so a `queryByTestId`
 * check can prove it is absent from the DOM (AC4).
 *
 * For a removable installation, "remove entry only" and "remove from disk" are a two-outcome
 * choice, entry-only pre-selected (today's default behaviour). Picking "remove from disk" only
 * reveals a second, in-place danger step naming the installation's `rootPath` - it does not call
 * `removeInstallation` itself (AC2: the path must be shown before anything happens). Only that
 * step's own "Delete folder" button submits. The disk choice is disabled (not hidden) while this
 * installation's own game is running (AC5), mirroring `ActionBar`'s
 * `launch.installationId === installation.id && (launch.phase === 'running' || 'starting')` gate.
 */
export function RemoveInstallationDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const installation = useInstallationById(installationId)
  const closeDialog = useLauncher((state) => state.closeDialog)
  const removeInstallation = useLauncher((state) => state.removeInstallation)
  const launch = useLauncher((state) => state.launch)
  const [choice, setChoice] = useState<RemovalChoice>('entry-only')
  const [submitting, setSubmitting] = useState(false)

  if (!installation) return null

  const storeManaged = isStoreManaged(installation.source)
  const runningHere =
    launch.installationId === installation.id &&
    (launch.phase === 'running' || launch.phase === 'starting')
  const deletingFromDisk = !storeManaged && choice === 'delete-from-disk'

  const submit = async (deleteFromDisk: boolean): Promise<void> => {
    setSubmitting(true)
    await removeInstallation(installation.id, deleteFromDisk)
    setSubmitting(false)
    closeDialog()
  }

  return (
    <Modal
      open
      size="sm"
      title={t('dialog.remove.title', { name: installation.name })}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={submitting || (deletingFromDisk && runningHere)}
            data-testid={deletingFromDisk ? 'remove-dialog-delete-folder-confirm' : undefined}
            onClick={() => void submit(deletingFromDisk)}
          >
            {deletingFromDisk ? t('dialog.remove.diskConfirmButton') : t('dialog.remove.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {storeManaged ? (
          <>
            <p className="text-sm leading-relaxed text-ink-dim">{t('dialog.remove.body')}</p>
            <p
              className="flex items-start gap-2 rounded-sm border border-success/30 bg-success/8 p-2.5 text-xs leading-relaxed text-ink-dim"
              data-testid="remove-dialog-store-note"
            >
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>{t('dialog.remove.storeManagedNote')}</span>
            </p>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <ChoiceOption
                selected={choice === 'entry-only'}
                onClick={() => setChoice('entry-only')}
                testId="remove-dialog-entry-only-option"
                label={t('dialog.remove.optionEntryOnly')}
              />
              <ChoiceOption
                selected={choice === 'delete-from-disk'}
                disabled={runningHere}
                disabledReason={t('dialog.remove.diskDisabledWhileRunning')}
                onClick={() => setChoice('delete-from-disk')}
                testId="remove-dialog-disk-option"
                label={t('dialog.remove.optionDeleteFromDisk')}
              />
            </div>

            {choice === 'entry-only' && (
              <p className="flex items-start gap-2 rounded-sm border border-success/30 bg-success/8 p-2.5 text-xs leading-relaxed text-ink-dim">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                <span className="numeric" data-selectable>
                  {t('dialog.remove.pathNote', { path: installation.rootPath })}
                </span>
              </p>
            )}

            {deletingFromDisk && (
              <div
                className="space-y-2 rounded-sm border border-danger/35 bg-danger/8 p-3"
                data-testid="remove-dialog-disk-confirm-step"
              >
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-danger">
                      {t('dialog.remove.diskConfirmTitle')}
                    </p>
                    <p className="text-xs leading-relaxed text-ink-dim">
                      {t('dialog.remove.diskConfirmBody')}
                    </p>
                  </div>
                </div>
                <p
                  className="numeric rounded-sm border border-danger/30 bg-void/20 p-2 text-xs text-danger"
                  data-testid="remove-dialog-disk-path"
                  data-selectable
                >
                  {installation.rootPath}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/**
 * One row of the entry-only/delete-from-disk chooser. Mirrors `RetailUpgradeDialog`'s
 * `retail-upgrade-source-item` idiom (full-width row, filled circle marker, `aria-pressed`) - the
 * closest existing "choice of options" pattern in this codebase - rather than inventing a new one.
 */
function ChoiceOption({
  selected,
  disabled,
  disabledReason,
  onClick,
  testId,
  label,
}: {
  selected: boolean
  disabled?: boolean
  disabledReason?: string
  onClick: () => void
  testId: string
  label: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-3 rounded-sm border p-2.5 text-left text-sm transition-colors duration-[--dur-fast]',
        disabled
          ? 'cursor-not-allowed border-line bg-raised/40 text-ink-faint opacity-60'
          : selected
            ? 'border-flame-600 bg-flame-900/20 text-ink'
            : 'border-line-strong bg-raised text-ink-dim hover:border-line-strong hover:text-ink',
      )}
    >
      <span
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full border',
          selected ? 'border-flame-500 bg-flame-500 text-flame-ink' : 'border-line-strong bg-transparent',
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
      {label}
    </button>
  )
}
