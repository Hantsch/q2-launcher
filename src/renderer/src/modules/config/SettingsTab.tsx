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
  onChanged: (profiles: ConfigProfile[]) => void
}

/**
 * The settings/cvar section of a config profile's detail view: one editable
 * `CvarRow` per entry in `PLAYER_CVARS` and `GRAPHICS_CVARS`, grouped into
 * two panels. Edits update local state immediately and persist to the main
 * process, debounced, via `updateProfileCvars` - which replaces the whole
 * cvars map, so every save sends the full merged `localCvars`, not a diff.
 *
 * The engine every row resolves its facts against is owned here and chosen by
 * `EngineScopeSelect` from the profile's assignments. It is deliberately
 * nullable: when the profile is assigned nowhere, or only to engines the
 * catalog has no facts for, the rows are still rendered (AC 3) but with no
 * engine - never with r1q2's numbers under another engine's name. Both
 * components derive the assigned engines through `lib/engine-scope.ts`, so
 * neither owns a second copy of story 002's assignment cross-reference.
 */
export function SettingsTab({ profile, onChanged }: SettingsTabProps) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const [engine, setEngine] = useState<EngineKind | null>(null)
  const [localCvars, setLocalCvars] = useState<Record<string, string>>(profile.cvars)
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

  // Re-seed local state whenever the selected profile changes (switching
  // profiles in the master list), dropping any save still pending for the
  // profile being switched away from.
  useEffect(() => {
    setLocalCvars(profile.cvars)
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
          setStatus('idle')
        }
      })
    }, SAVE_DEBOUNCE_MS)
  }

  const handleChange = (name: string, value: string): void => {
    setLocalCvars((prev) => {
      const next = { ...prev, [name]: value }
      scheduleSave(next)
      return next
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
              value={localCvars[def.name] ?? ''}
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
              value={localCvars[def.name] ?? ''}
              onChange={(value) => handleChange(def.name, value)}
            />
          ))}
        </div>
      </Panel>
    </div>
  )
}
