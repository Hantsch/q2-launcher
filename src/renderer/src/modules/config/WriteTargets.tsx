import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile, WriteTargetResult, WriteTargetStatus } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/controls'
import { Badge, SectionLabel, type BadgeTone } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { getWriteState, setPlayedMods, writeConfigProfile } from './client'

/** A row's status before any write has happened, in addition to the four the main process can report. */
type RowStatus = WriteTargetStatus | 'writing'

const STATUS_TONE: Record<RowStatus, BadgeTone> = {
  written: 'success',
  unchanged: 'neutral',
  pending: 'warning',
  error: 'danger',
  writing: 'neutral',
}

/**
 * Per-profile write status, one row per installation the profile is assigned
 * to: the last write outcome for that installation, a Retry action for
 * `pending`/`error` rows, and a played-mods checkbox list fed by that
 * installation's `gameDirs`.
 *
 * A write is triggered automatically whenever `profile.updatedAt` changes for
 * a profile already mounted here (but deliberately NOT on first mount/select
 * of a profile - see the `lastSeenUpdatedAt` ref below) - this module has no
 * separate "Save" button anywhere (`SettingsTab` already autosaves cvar
 * edits), so "saving writes the profile to disk" is implemented here as
 * reacting to the already-debounced `updatedAt` bump, not as a second save
 * path.
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
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({})
  const [messageKeys, setMessageKeys] = useState<Record<string, string | undefined>>({})

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

  const applyResults = (results: WriteTargetResult[]): void => {
    setStatuses((prev) => {
      const next = { ...prev }
      for (const result of results) next[result.installationId] = result.status
      return next
    })
    setMessageKeys((prev) => {
      const next = { ...prev }
      for (const result of results) next[result.installationId] = result.messageKey
      return next
    })
  }

  const performWrite = async (): Promise<void> => {
    setStatuses((prev) => {
      const next = { ...prev }
      for (const assignment of profile.assignments) next[assignment.installationId] = 'writing'
      return next
    })
    const result = await writeConfigProfile({ profileId: profile.id })
    if (result.ok) applyResults(result.value)
  }

  // Seed pending state from main on mount / profile change, so a reload does
  // not lose "this installation is still waiting on the game to quit". Only
  // entries pending for *this* profile are relevant here.
  useEffect(() => {
    let cancelled = false
    void getWriteState().then((result) => {
      if (cancelled || !result.ok) return
      const seeded: Record<string, RowStatus> = {}
      for (const [installationId, pendingProfileId] of Object.entries(result.value)) {
        if (pendingProfileId === profile.id) seeded[installationId] = 'pending'
      }
      // `prev` wins over `seeded` for any key already set, so a fresh result
      // from `performWrite` below (which can resolve first or last) is never
      // clobbered by this seed.
      setStatuses((prev) => ({ ...seeded, ...prev }))
    })
    return () => {
      cancelled = true
    }
  }, [profile.id])

  /**
   * Which `updatedAt` this component has already reacted to, per profile id -
   * so that merely *selecting* an existing profile (mounting/switching to it,
   * which changes `profile.id` without the user editing anything) is never
   * mistaken for a save. `useRef` rather than state: this bookkeeping must
   * never itself cause a render.
   */
  const lastSeenUpdatedAt = useRef<Map<string, string>>(new Map())

  // Saving a profile writes its content to disk: trigger on every real save
  // (every `updatedAt` bump) of the profile currently shown, and only that -
  // Decision 11 is explicit that nothing writes into a game folder the user
  // did not ask for. The first time a given profile.id is seen in this
  // component's lifetime is therefore deliberately NOT a trigger, even though
  // it also matches "profile.id changed": it is a selection, not a save. No
  // debounce needed beyond that - `SettingsTab` already debounced the edit
  // before `updatedAt` changed.
  useEffect(() => {
    const previouslySeen = lastSeenUpdatedAt.current.get(profile.id)
    lastSeenUpdatedAt.current.set(profile.id, profile.updatedAt)
    if (previouslySeen === undefined || previouslySeen === profile.updatedAt) return
    void performWrite()
    // Deliberately keyed on id/updatedAt only, not on `performWrite` or
    // `profile.assignments` - only a real save (an `updatedAt` bump on a
    // profile already mounted here) should trigger a fresh write.
  }, [profile.id, profile.updatedAt])

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

  const rows = profile.assignments
    .map((assignment) => installations.find((inst) => inst.id === assignment.installationId))
    .filter((installation): installation is NonNullable<typeof installation> => installation !== undefined)

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.writeTargets.label')}</SectionLabel>

      {rows.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('config.assignment.noInstallations')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((installation) => {
            const status = statuses[installation.id]
            const messageKey = messageKeys[installation.id]
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
                    {status && (
                      <Badge tone={STATUS_TONE[status]}>
                        {t(`config.writeTargets.status.${status}`)}
                      </Badge>
                    )}
                    {(status === 'pending' || status === 'error') && (
                      <Button variant="ghost" size="sm" onClick={() => void performWrite()}>
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

                {messageKey && (status === 'error' || status === 'pending') && (
                  <p className="text-xs text-ink-muted">{t(messageKey)}</p>
                )}

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
