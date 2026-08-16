import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { getSwitchBinds } from './client'
import { SwitchBindControl } from './SwitchBindControl'

/**
 * The installation-side half of assignment: for every registered
 * installation, which config profiles are currently assigned to it, with the
 * per-installation default called out, plus (story 007) that installation's
 * in-session profile-switch bind when it has 2+ assigned profiles (AC 5).
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
 */
export function InstallationProfilesPanel({ profiles }: { profiles: ConfigProfile[] }) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const [switchBinds, setSwitchBinds] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    void getSwitchBinds().then((result) => {
      if (!cancelled && result.ok) setSwitchBinds(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

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
                <span className="min-w-0 shrink-0 truncate text-sm text-ink-dim">
                  {installation.name}
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
    </div>
  )
}
