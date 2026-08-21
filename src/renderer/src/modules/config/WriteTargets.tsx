import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ConfigProfile,
  ProfileFileSync,
  ProfileFileSyncStatus,
  ProfileSyncState,
} from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/controls'
import { Badge, SectionLabel, type BadgeTone } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { getProfileSyncState, setPlayedMods, writeConfigProfile } from './client'

/** A row's status before the first `syncState` response has landed, in addition to the five the main process can report. */
type RowStatus = ProfileFileSyncStatus | 'loading'

const STATUS_TONE: Record<RowStatus, BadgeTone> = {
  inSync: 'success',
  outOfSync: 'warning',
  missing: 'neutral',
  pending: 'warning',
  error: 'danger',
  loading: 'neutral',
}

/**
 * Per-profile write status: a row for the profile's own canonical file plus
 * one row per installation the profile is assigned to, each showing its
 * on-disk path and its live sync status (read via `syncState`, never
 * written by this component itself), a Retry action for `pending`/`error`
 * rows, and (installation rows only) a played-mods checkbox list fed by that
 * installation's `gameDirs`.
 *
 * As of story 022, every mutating config IPC call in main already awaits a
 * full write-to-disk before it returns - by the time `profile.updatedAt`
 * changes here, the write has already happened. So this component no longer
 * triggers a write on save; it only re-fetches the current status, on mount
 * and whenever `profile.updatedAt` bumps. The one place a write is still
 * triggered from here is the Retry button, for the `error`/`pending` case.
 *
 * `onPreview` opens the preview modal for a row.
 */
export function WriteTargets({
  profile,
  onPreview,
}: {
  profile: ConfigProfile
  onPreview?: (installationId: string) => void
}) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const [sync, setSync] = useState<ProfileSyncState | null>(null)

  /**
   * Played-mods selection per installation, for this session only. The
   * config contract has `setPlayedMods` but no getter for an installation's
   * currently persisted played mods (deliberately - extending the contract
   * is not this deliverable's job), so there is nothing to seed this from on
   * mount. It starts empty and only reflects what `setPlayedMods`'s own
   * response confirms after a toggle, same "trust only the round-trip"
   * discipline as the rest of this module. Known gap: this list does not
   * survive a reload/reselect of the profile within this deliverable.
   */
  const [playedMods, setPlayedModsState] = useState<Record<string, string[]>>({})

  const refetchSyncState = async (): Promise<void> => {
    const result = await getProfileSyncState({ profileId: profile.id })
    if (result.ok) setSync(result.value)
  }

  // `assign`/`unassign`/`setDefault` change which installations this profile
  // is assigned to WITHOUT bumping `updatedAt` (`assignments.ts` deliberately
  // stamps no clock - see its own file doc comment), so a plain
  // `profile.updatedAt` dependency alone misses exactly those three changes:
  // a newly assigned installation's row would sit at the `'loading'` status
  // forever, since nothing would ever ask main for its real status (review
  // finding). This key changes whenever the *set* of assigned installations
  // changes, independent of `updatedAt`.
  const assignmentKey = profile.assignments
    .map((assignment) => assignment.installationId)
    .sort()
    .join(',')

  // Read (never write) the current sync status: on mount/select of a profile,
  // on every real save (an `updatedAt` bump), and whenever the assigned
  // installation set changes. Unlike a write trigger, this deliberately DOES
  // fire on first mount/select too - reading status is never "writing into a
  // game folder the user didn't ask for", so a freshly created, unassigned
  // profile shows its already-written canonical file's status immediately, no
  // edit required.
  useEffect(() => {
    void refetchSyncState()
    // `refetchSyncState` is a plain async function recreated every render and
    // reading nothing but stable IPC plumbing - depending on it would only
    // add a spurious refetch on every unrelated re-render, not a missed one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.updatedAt, assignmentKey])

  const retry = async (): Promise<void> => {
    await writeConfigProfile({ profileId: profile.id })
    // `syncState` is the authoritative source of what actually ended up on
    // disk - including the canonical file, which `write`'s own result never
    // reports a status for, but which `write` does attempt to rewrite as a
    // side effect - so always refetch regardless of `write`'s own result.
    await refetchSyncState()
  }

  const togglePlayedMod = async (
    installationId: string,
    mod: string,
    checked: boolean,
  ): Promise<void> => {
    const current = playedMods[installationId] ?? []
    const next = checked ? [...current, mod] : current.filter((entry) => entry !== mod)
    const result = await setPlayedMods({ installationId, playedMods: next })
    if (result.ok) {
      setPlayedModsState((prev) => ({ ...prev, [installationId]: result.value }))
    }
  }

  if (!sync) return null

  const rows = profile.assignments
    .map((assignment) => installations.find((inst) => inst.id === assignment.installationId))
    .filter((installation): installation is NonNullable<typeof installation> => installation !== undefined)

  const renderPath = (file: ProfileFileSync): React.ReactNode => (
    <p
      className="numeric min-w-0 truncate text-xs text-ink-dim"
      title={file.path}
      data-selectable
    >
      {file.path}
    </p>
  )

  const renderMessage = (file: ProfileFileSync): React.ReactNode =>
    file.messageKey &&
    (file.status === 'error' || file.status === 'pending') && (
      <p className="text-xs text-ink-muted">{t(file.messageKey)}</p>
    )

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.writeTargets.label')}</SectionLabel>

      <div className="space-y-1.5 rounded-sm border border-line px-2.5 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm text-ink">{t('config.writeTargets.own')}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone={STATUS_TONE[sync.own.status]}>
              {t(`config.writeTargets.status.${sync.own.status}`)}
            </Badge>
            {(sync.own.status === 'pending' || sync.own.status === 'error') && (
              <Button variant="ghost" size="sm" onClick={() => void retry()}>
                {t('config.writeTargets.retry')}
              </Button>
            )}
          </div>
        </div>
        {renderPath(sync.own)}
        {renderMessage(sync.own)}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('config.assignment.noInstallations')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((installation) => {
            const installationSync = sync.installations.find(
              (entry) => entry.installationId === installation.id,
            )
            const status: RowStatus = installationSync?.status ?? 'loading'
            const mods = installation.gameDirs.filter((dir) => dir.toLowerCase() !== 'baseq2')
            const checkedMods = playedMods[installation.id] ?? []

            return (
              <li
                key={installation.id}
                className="space-y-2 rounded-sm border border-line px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-ink">{installation.name}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={STATUS_TONE[status]}>
                      {t(`config.writeTargets.status.${status}`)}
                    </Badge>
                    {(status === 'pending' || status === 'error') && (
                      <Button variant="ghost" size="sm" onClick={() => void retry()}>
                        {t('config.writeTargets.retry')}
                      </Button>
                    )}
                    {onPreview && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onPreview(installation.id)}
                      >
                        {t('config.writeTargets.preview')}
                      </Button>
                    )}
                  </div>
                </div>

                {installationSync && renderPath(installationSync)}
                {installationSync && renderMessage(installationSync)}

                <div className="space-y-1">
                  <span className="stencil">{t('config.writeTargets.playedMods')}</span>
                  {mods.length === 0 ? (
                    <p className="text-xs text-ink-muted">{t('config.writeTargets.noMods')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {mods.map((mod) => (
                        <Checkbox
                          key={mod}
                          checked={checkedMods.includes(mod)}
                          onChange={(next) => void togglePlayedMod(installation.id, mod, next)}
                          label={mod}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
