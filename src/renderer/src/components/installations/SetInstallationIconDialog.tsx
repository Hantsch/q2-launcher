import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SHIPPED_ICONS } from '../../lib/installation-icons'
import { cn } from '../../lib/cn'
import { useInstallationById, useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/**
 * Story 067 D6: lets the user give an installation an icon from the shipped set (D1's
 * `SHIPPED_ICONS`), pick their own image file, or clear back to the default code tile.
 *
 * Mirrors `RenameInstallationDialog`'s shell/store-call/Outcome shape, but does not close on
 * success (unlike rename): AC5 exercises "pick a shipped icon, then clear" as two actions inside
 * one open dialog, and staying open also lets the user see the icon they just picked highlighted
 * in the grid before deciding whether to keep it. A failed `Outcome` (AC6) renders its i18n key
 * inline and never closes the dialog or touches the installation's current icon - both handlers
 * (`installations:setIcon`/`installations:pickIconFile`, D4) already guarantee nothing is
 * persisted on failure; this only has to surface the message.
 */
export function SetInstallationIconDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const installation = useInstallationById(installationId)
  const closeDialog = useLauncher((state) => state.closeDialog)
  const setInstallationIcon = useLauncher((state) => state.setInstallationIcon)
  const pickInstallationIconFile = useLauncher((state) => state.pickInstallationIconFile)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ key: string; params?: Record<string, string | number> } | null>(
    null,
  )

  if (!installation) return null

  const hasIcon = Boolean(installation.icon)

  const applyOutcome = (result: Awaited<ReturnType<typeof setInstallationIcon>>): void => {
    setError(result.ok ? null : { key: result.error.key, ...(result.error.params ? { params: result.error.params } : {}) })
  }

  const pickShipped = async (id: string): Promise<void> => {
    setPending(true)
    const result = await setInstallationIcon(installation.id, { kind: 'shipped', id })
    setPending(false)
    applyOutcome(result)
  }

  const chooseFile = async (): Promise<void> => {
    setPending(true)
    const result = await pickInstallationIconFile(installation.id)
    setPending(false)
    applyOutcome(result)
  }

  const clear = async (): Promise<void> => {
    setPending(true)
    const result = await setInstallationIcon(installation.id, null)
    setPending(false)
    applyOutcome(result)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('dialog.installationIcon.title', { name: installation.name })}
      onClose={closeDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={!hasIcon || pending}
            onClick={() => void clear()}
          >
            {t('dialog.installationIcon.clear')}
          </Button>
          <Button variant="primary" onClick={closeDialog}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t(error.key, error.params)}
          </p>
        )}

        <div>
          <p className="mb-2 text-xs tracking-wide text-ink-dim uppercase">
            {t('dialog.installationIcon.shippedLabel')}
          </p>
          <div className="grid grid-cols-6 gap-2">
            {SHIPPED_ICONS.map((shipped) => {
              const selected = installation.icon?.kind === 'shipped' && installation.icon.id === shipped.id
              return (
                <button
                  key={shipped.id}
                  type="button"
                  disabled={pending}
                  aria-pressed={selected}
                  aria-label={t('dialog.installationIcon.shippedIconLabel', { id: shipped.id })}
                  onClick={() => void pickShipped(shipped.id)}
                  className={cn(
                    'grid size-11 place-items-center rounded-md border transition-colors disabled:pointer-events-none disabled:opacity-45',
                    selected ? 'border-flame-400' : 'border-line hover:border-line-strong',
                  )}
                >
                  <img
                    src={shipped.url}
                    alt=""
                    aria-hidden="true"
                    className="size-full rounded-[inherit] object-cover"
                  />
                </button>
              )
            })}
          </div>
        </div>

        <Button variant="neutral" disabled={pending} onClick={() => void chooseFile()}>
          {t('dialog.installationIcon.chooseFile')}
        </Button>
      </div>
    </Modal>
  )
}
