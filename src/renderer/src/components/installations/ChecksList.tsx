import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import type { Installation, ValidationCheck, ValidationFix } from '@shared/types'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { invoke } from '../../lib/bridge'
import { Button } from '../ui/Button'

const SEVERITY = {
  ok: { icon: CircleCheck, className: 'text-success' },
  warn: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: CircleX, className: 'text-danger' },
} as const

/**
 * The validation checks for an installation, each with the one action that
 * resolves it.
 *
 * Every failure is actionable: this is what stops a broken installation from
 * being a dead end. Fixes that belong to a module that does not exist yet
 * (getting game files) route to that module's page, which explains itself.
 */
export function ChecksList({
  installation,
  className,
}: {
  installation: Installation
  className?: string
}) {
  const { t } = useTranslation()

  if (installation.checks.length === 0) {
    return (
      <p className={cn('flex items-center gap-2 text-xs text-success', className)}>
        <CircleCheck className="size-3.5" />
        {t('validation.allGood')}
      </p>
    )
  }

  return (
    <ul className={cn('space-y-2', className)}>
      {installation.checks.map((check) => (
        <CheckRow key={check.id} installation={installation} check={check} />
      ))}
    </ul>
  )
}

function CheckRow({ installation, check }: { installation: Installation; check: ValidationCheck }) {
  const { t } = useTranslation()
  const { icon: Icon, className } = SEVERITY[check.severity]
  const runFix = useFixAction()
  const fix = check.fix

  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', className)} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs leading-relaxed text-ink-dim" data-selectable>
          {t(check.messageKey, check.params ?? {})}
        </p>
        {fix && (
          <Button variant="link" size="sm" onClick={() => void runFix(installation, fix)}>
            {t(`validation.fix.${fix}`)}
          </Button>
        )}
      </div>
    </li>
  )
}

/**
 * Maps a `ValidationFix` to the flow that resolves it.
 *
 * Takes the installation as an argument rather than a hook parameter so callers
 * that may not have one yet (the action bar with nothing selected) can still
 * call the hook unconditionally.
 */
export function useFixAction(): (installation: Installation, fix: ValidationFix) => Promise<void> {
  const { t } = useTranslation()
  const updateInstallation = useLauncher((state) => state.updateInstallation)
  const validateInstallation = useLauncher((state) => state.validateInstallation)
  const setRoute = useLauncher((state) => state.setRoute)

  return async (installation: Installation, fix: ValidationFix) => {
    switch (fix) {
      case 'revalidate':
        await validateInstallation(installation.id)
        return

      case 'locate-root': {
        const picked = await invoke('installations:pickFolder', {
          title: t('dialog.addExisting.pickTitle'),
          buttonLabel: t('dialog.addExisting.pickButton'),
        })
        if (picked) await updateInstallation({ id: installation.id, rootPath: picked })
        return
      }

      case 'select-executable': {
        const picked = await invoke('installations:pickExecutable', {
          title: t('installation.action.selectExecutable'),
          defaultPath: installation.rootPath,
        })
        if (picked) await updateInstallation({ id: installation.id, executablePath: picked })
        return
      }

      case 'set-write-dir': {
        const picked = await invoke('installations:pickFolder', {
          title: t('installation.action.setWriteDir'),
          defaultPath: installation.rootPath,
        })
        if (picked) await updateInstallation({ id: installation.id, writeDirPath: picked })
        return
      }

      case 'install-game-files':
        // Owned by the install module. Its page states plainly that it is not
        // built yet, which beats a button that silently does nothing.
        setRoute('/install')
        return
    }
  }
}
