import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import type { Installation } from '@shared/types/installation'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EngineBadge } from '../../components/ui/EngineBadge'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import { useSubmitting } from '../../components/ui/useSubmitting'
import { useLauncher } from '../../store/useLauncher'
import { getSwitchBinds, listOriginalConfigs, restoreOriginalConfigs } from './client'
import { useConfigProfiles } from './config-profiles-store'
import { SwitchBindControl } from './SwitchBindControl'

/**
 * The installation-side half of assignment: for every registered
 * installation, which config profiles are currently assigned to it, with the
 * per-installation default called out, plus (story 007) that installation's
 * in-session profile-switch bind when it has 2+ assigned profiles.
 *
 * Mostly derived and read-only - it does not fetch or mutate `profiles` or
 * `installations`. Every render re-derives assignment from `profiles` (owned
 * by `ConfigView.tsx`) and the live `installations` from `useLauncher`, so it
 * always reflects the latest state of both without any caching of its own.
 * The switch-bind map is the one exception: `ConfigView.tsx` has no existing
 * owner for per-installation, cross-profile data like this (it only tracks
 * `profiles`), so this component fetches `switchBinds` itself on mount -
 * mirrors `WriteTargets.tsx` fetching `getWriteState()` - and keeps it as
 * local state that `SwitchBindControl`'s `onChanged` updates after each real
 * round trip (no optimistic local state, same discipline as the rest of this
 * module).
 *
 * An installation whose original configs are backed up gets a restore action; the backup list
 * is re-read whenever `profiles` changes, since assigning is what creates a backup and restoring
 * is what removes it (story 254).
 */
export function InstallationProfilesPanel({ profiles }: { profiles: ConfigProfile[] }) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const replaceAll = useConfigProfiles((state) => state.replaceAll)
  const [switchBinds, setSwitchBinds] = useState<Record<string, string>>({})
  const [backedUp, setBackedUp] = useState<string[]>([])
  const [restoring, setRestoring] = useState<Installation | null>(null)
  const [restoreError, setRestoreError] = useState<ReactNode>(null)
  const { submitting, run } = useSubmitting()

  useEffect(() => {
    let cancelled = false
    void getSwitchBinds().then((result) => {
      if (!cancelled && result.ok) setSwitchBinds(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void listOriginalConfigs().then((result) => {
      if (!cancelled && result.ok) setBackedUp(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [profiles])

  const closeRestore = useCallback(() => {
    setRestoring(null)
    setRestoreError(null)
  }, [])

  const confirmRestore = (installation: Installation): void =>
    void run(async () => {
      const result = await restoreOriginalConfigs({ installationId: installation.id })
      if (!result.ok) {
        setRestoreError(
          <p role="alert" className="text-xs text-danger">
            {t(result.error.key, result.error.params)}
          </p>,
        )
        return
      }
      replaceAll(result.value)
      closeRestore()
      const refreshed = await listOriginalConfigs()
      if (refreshed.ok) setBackedUp(refreshed.value)
    })

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.assignment.byInstallation')}</SectionLabel>

      {installations.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('config.assignment.noInstallations')}</p>
      ) : (
        <ul className="space-y-1.5">
          {installations.map((installation) => {
            const assigned = profiles.filter((profile) =>
              profile.assignments.some((entry) => entry.installationId === installation.id),
            )

            return (
              <li
                key={installation.id}
                className="flex flex-wrap items-center gap-2 rounded-sm border border-line px-2.5 py-2"
              >
                <span className="min-w-0 truncate text-sm text-ink-dim">{installation.name}</span>
                <span className="shrink-0">
                  <EngineBadge engineKind={installation.engineKind} />
                </span>

                {assigned.length === 0 ? (
                  <span className="text-xs text-ink-muted">
                    {t('config.assignment.noneAssigned')}
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {assigned.map((profile) => {
                      const isDefault = profile.assignments.some(
                        (entry) => entry.installationId === installation.id && entry.isDefault,
                      )
                      return (
                        <Badge key={profile.id} tone={isDefault ? 'flame' : 'neutral'}>
                          {profile.name}
                          {isDefault && ` · ${t('config.assignment.default')}`}
                        </Badge>
                      )
                    })}
                  </div>
                )}

                {backedUp.includes(installation.id) && (
                  <Button
                    size="sm"
                    variant="neutral"
                    data-testid="config-restore-originals"
                    onClick={() => setRestoring(installation)}
                  >
                    {t('config.assignment.restoreOriginals.action')}
                  </Button>
                )}

                {assigned.length >= 2 && (
                  <SwitchBindControl
                    installationId={installation.id}
                    currentKey={switchBinds[installation.id]}
                    onChanged={setSwitchBinds}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {restoring && (
        <ConfirmDialog
          title={t('config.assignment.restoreOriginals.title', { name: restoring.name })}
          body={
            <div className="space-y-2">
              <p className="text-sm leading-relaxed text-ink-dim">
                {t('config.assignment.restoreOriginals.body')}
              </p>
              {restoreError}
            </div>
          }
          confirmLabel={t('config.assignment.restoreOriginals.confirm')}
          tone="danger"
          busy={submitting}
          onClose={closeRestore}
          onConfirm={() => confirmRestore(restoring)}
          testIds={{ confirm: 'config-restore-originals-confirm' }}
        />
      )}
    </div>
  )
}
