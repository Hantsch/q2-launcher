import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import type { EngineKind } from '@shared/types/engine'
import { GRAPHICS_CVARS, PLAYER_CVARS } from '@shared/config/cvar-catalog'
import { Panel, SectionLabel } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { CvarRow } from './components/CvarRow'
import { EngineScopeSelect } from './components/EngineScopeSelect'
import { assignedEngineKinds } from './lib/engine-scope'
import { updateProfileCvars } from './client'

const SAVE_DEBOUNCE_MS = 500

type SaveStatus = 'idle' | 'saving' | 'saved'

export interface SettingsTabProps {
  profile: ConfigProfile
  /** Story 009 D6: the shared in-progress draft, owned by `ConfigView`'s `useProfileDraft`. */
  draft: ConfigProfile
  patch: (partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>)) => void
  onChanged: (profiles: ConfigProfile[]) => void
}

/**
 * The settings/cvar section of a config profile's detail view: one editable
 * `CvarRow` per entry in `PLAYER_CVARS` and `GRAPHICS_CVARS`, grouped into
 * two panels. Edits write into the shared `draft` (story 009 D6) immediately
 * and persist to the main process, debounced, via `updateProfileCvars` -
 * which replaces the whole cvars map, so every save sends the full merged
 * `draft.cvars`, not a diff.
 *
 * Before story 009 this tab held its own `localCvars` state; that state is
 * now `draft.cvars`, lifted into `ConfigView` so the Validation tab can see
 * an edit the instant it happens, with no debounce and no IPC round trip in
 * between (AC 4). The debounce/status label below is unchanged - only *where*
 * the in-progress value lives has moved.
 *
 * The engine every row resolves its facts against is owned here and chosen by
 * `EngineScopeSelect` from the profile's assignments. It is deliberately
 * nullable: when the profile is assigned nowhere, or only to engines the
 * catalog has no facts for, the rows are still rendered (AC 3) but with no
 * engine - never with r1q2's numbers under another engine's name. Both
 * components derive the assigned engines through `lib/engine-scope.ts`, so
 * neither owns a second copy of story 002's assignment cross-reference.
 */
export function SettingsTab({ profile, draft, patch, onChanged }: SettingsTabProps) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const [engine, setEngine] = useState<EngineKind | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const assignedEngines = useMemo(
    () => assignedEngineKinds(profile, installations),
    [profile, installations],
  )
  const otherAssignedEngines = useMemo(
    () => assignedEngines.filter((kind) => kind !== engine),
    [assignedEngines, engine],
  )

  const clearPendingSave = (): void => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current)
      saveTimeout.current = null
    }
  }

  // Re-seed the save/status UI whenever the selected profile changes
  // (switching profiles in the master list), dropping any save still pending
  // for the profile being switched away from. The draft's own content reseed
  // is `useProfileDraft`'s job now, keyed on the same `profile.id`.
  useEffect(() => {
    setStatus('idle')
    clearPendingSave()
  }, [profile.id])

  useEffect(() => clearPendingSave, [])

  const scheduleSave = (next: Record<string, string>): void => {
    setStatus('saving')
    clearPendingSave()
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null
      void updateProfileCvars({ profileId: profile.id, cvars: next }).then((result) => {
        if (result.ok) {
          onChanged(result.value)
          setStatus('saved')
        } else {
          // Revert the optimistic patch: unlike the removed per-tab `useState`
          // (which self-corrected on every remount), the shared draft
          // (story 009 D6) survives a tab switch, so a failed save would
          // otherwise leave a phantom edit in the draft - and therefore in
          // the validator - indefinitely (review finding).
          patch({ cvars: profile.cvars })
          setStatus('idle')
        }
      })
    }, SAVE_DEBOUNCE_MS)
  }

  // Functional form: reads `prev.cvars` at commit time rather than the
  // `draft` closure captured when this callback was created, so two edits
  // landing in the same tick can never lose one of them (same guarantee the
  // removed `setLocalCvars(prev => ...)` had - review finding).
  const handleChange = (name: string, value: string): void => {
    patch((prev) => {
      const next = { ...prev.cvars, [name]: value }
      scheduleSave(next)
      return { cvars: next }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm tracking-[0.06em] text-ink uppercase">
          {t('config.settings.title')}
        </h3>
        {status !== 'idle' && (
          <span className="text-xs text-ink-muted">
            {status === 'saving' ? t('config.settings.saving') : t('config.settings.saved')}
          </span>
        )}
      </div>

      {/*
        `setEngine` is passed straight through: its identity is stable, which
        is what keeps `EngineScopeSelect`'s selection-repair effect from
        re-running on every render.
      */}
      <EngineScopeSelect profile={profile} value={engine} onChange={setEngine} />

      <Panel className="space-y-3 p-4">
        <SectionLabel>{t('config.settings.playerGroup')}</SectionLabel>
        <div className="space-y-2">
          {PLAYER_CVARS.map((def) => (
            <CvarRow
              key={def.name}
              def={def}
              engine={engine}
              otherAssignedEngines={otherAssignedEngines}
              value={draft.cvars[def.name] ?? ''}
              onChange={(value) => handleChange(def.name, value)}
            />
          ))}
        </div>
      </Panel>

      <Panel className="space-y-3 p-4">
        <SectionLabel>{t('config.settings.graphicsGroup')}</SectionLabel>
        <div className="space-y-2">
          {GRAPHICS_CVARS.map((def) => (
            <CvarRow
              key={def.name}
              def={def}
              engine={engine}
              otherAssignedEngines={otherAssignedEngines}
              value={draft.cvars[def.name] ?? ''}
              onChange={(value) => handleChange(def.name, value)}
            />
          ))}
        </div>
      </Panel>
    </div>
  )
}
