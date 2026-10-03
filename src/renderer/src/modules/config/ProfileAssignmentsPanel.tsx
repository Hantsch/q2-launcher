import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/controls'
import { EngineBadge } from '../../components/ui/EngineBadge'
import { Badge, SectionLabel } from '../../components/ui/primitives'
import { assignConfigProfile, setDefaultConfigProfile, unassignConfigProfile } from './client'
import { useProfileDraftContext } from './lib/ProfileDraftProvider'
import { useProfileSave } from './lib/useProfileSave'

/**
 * The profile-side half of assignment: for the currently selected profile,
 * one row per registered installation with a checkbox to assign/unassign it
 * and, once assigned, an affordance to mark it that installation's default.
 *
 * Every mutation round-trips through main (see `client.ts`) and only updates
 * the view via `save` once the real outcome comes back - no optimistic
 * local state, so a failed call simply leaves the row as it was.
 */
export function ProfileAssignmentsPanel() {
  const { t } = useTranslation()
  const { profile, installations, save } = useProfileDraftContext()

  const { saveNow } = useProfileSave({ profileId: profile.id, onChanged: save })

  const toggle = async (installationId: string, next: boolean): Promise<void> => {
    await saveNow({
      run: () =>
        next
          ? assignConfigProfile({ profileId: profile.id, installationId })
          : unassignConfigProfile({ profileId: profile.id, installationId }),
    })
  }

  const makeDefault = async (installationId: string): Promise<void> => {
    await saveNow({
      run: () => setDefaultConfigProfile({ profileId: profile.id, installationId }),
    })
  }

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.assignment.label')}</SectionLabel>

      {installations.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('config.assignment.noInstallations')}</p>
      ) : (
        <ul className="space-y-1.5">
          {installations.map((installation) => {
            const assignment = profile.assignments.find(
              (entry) => entry.installationId === installation.id,
            )
            const assigned = assignment !== undefined

            return (
              <li
                key={installation.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-line px-2.5 py-2"
              >
                <Checkbox
                  checked={assigned}
                  onChange={(next) => void toggle(installation.id, next)}
                  label={
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate">{installation.name}</span>
                      <span className="shrink-0">
                        <EngineBadge engineKind={installation.engineKind} />
                      </span>
                    </span>
                  }
                  className="min-w-0"
                />

                {assigned &&
                  (assignment.isDefault ? (
                    <Badge tone="flame">{t('config.assignment.default')}</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void makeDefault(installation.id)}
                    >
                      {t('config.assignment.setDefault')}
                    </Button>
                  ))}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
