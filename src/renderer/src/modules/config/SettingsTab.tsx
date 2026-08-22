import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import type { CvarDef } from '@shared/config/cvar-facts'
import { CVAR_GROUP_ORDER } from '@shared/config/cvar-facts'
import type { EngineKind } from '@shared/types/engine'
import { ALL_CVARS } from '@shared/config/cvar-catalog'
import { Button } from '../../components/ui/Button'
import { Input, Switch } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { useLauncher } from '../../store/useLauncher'
import { CvarRow } from './components/CvarRow'
import { EngineScopeSelect } from './components/EngineScopeSelect'
import { assignedEngineKinds } from './lib/engine-scope'
import { buildCvarGroups, type CvarGroupResult } from './lib/cvar-rows'
import { updateProfileCvars } from './client'

const SAVE_DEBOUNCE_MS = 500

/** Fixed group order for the Settings tab - mirrors `cvar-rows.ts`'s own `GROUP_ORDER`, which is
 * not exported: this file only needs to iterate the four groups once each to build one
 * `buildCvarGroups` call per group (each call scoped to that group's own defs, so its
 * `showAdvanced` can be that group's own local expand state). Sourced from the shared
 * `CVAR_GROUP_ORDER` (story 040 D1) rather than a local copy, same reason `cvar-rows.ts` does. */
const GROUP_ORDER: CvarDef['group'][] = [...CVAR_GROUP_ORDER]

const GROUP_LABEL_KEY: Record<CvarDef['group'], string> = {
  player: 'config.settings.groups.player',
  network: 'config.settings.groups.network',
  graphics: 'config.settings.groups.graphics',
  sound: 'config.settings.groups.sound',
}

type SaveStatus = 'idle' | 'saving' | 'saved'

export interface SettingsTabProps {
  profile: ConfigProfile
  /** Story 009 D6: the shared in-progress draft, owned by `ConfigView`'s `useProfileDraft`. */
  draft: ConfigProfile
  patch: (partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>)) => void
  onChanged: (profiles: ConfigProfile[]) => void
}

/**
 * The settings/cvar section of a config profile's detail view (story 021 D4): a capped, dense list
 * of every `ALL_CVARS` entry, grouped by `def.group` into sticky-headed Player/Network/Graphics/
 * Sound sections, with a header bar for the catalogue-wide counts, a session-local filter and
 * "changed only" toggle, a "Reset all" confirm dialog and a per-group Advanced collapse.
 *
 * This rewrite replaces the two hard-coded `PLAYER_CVARS`/`GRAPHICS_CVARS` panels the tab used to
 * render - `buildCvarGroups` (story 021 D1) now owns grouping, filtering and the "changed" count,
 * so this file only wires state to it and to `CvarRow` (D2/D3).
 *
 * Edits write into the shared `draft` (story 009 D6) immediately and persist to the main process,
 * debounced, via `updateProfileCvars` - which replaces the whole cvars map, so every save sends the
 * full merged `draft.cvars`, not a diff. The autosave mechanism below
 * (`SAVE_DEBOUNCE_MS`/`scheduleSave`/`handleChange`/the failure-path `patch({ cvars: profile.cvars
 * })` revert) is carried over unchanged from the previous version of this file - the redesign only
 * replaces the JSX around it (story 021 Decisions).
 *
 * The engine every row resolves its facts against is owned here and chosen by `EngineScopeSelect`
 * from the profile's assignments. It is deliberately nullable: when the profile is assigned
 * nowhere, or only to engines the catalog has no facts for, the rows are still rendered but with no
 * engine - never with r1q2's numbers under another engine's name. Both components derive the
 * assigned engines through `lib/engine-scope.ts`, so neither owns a second copy of story 002's
 * assignment cross-reference.
 */
export function SettingsTab({ profile, draft, patch, onChanged }: SettingsTabProps) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const [engine, setEngine] = useState<EngineKind | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Filter, "changed only" and the per-group Advanced collapse are session-local UI state (story
  // 021 Decisions: "not persisted per profile, no extra saved UI state") - reset below whenever the
  // selected profile changes, alongside the save/status reset that already ran here.
  const [filter, setFilter] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<CvarDef['group']>>(new Set())
  const [confirmResetAllOpen, setConfirmResetAllOpen] = useState(false)

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

  // Re-seed the save/status UI and the session-local filter/toggle/Advanced state whenever the
  // selected profile changes (switching profiles in the master list), dropping any save still
  // pending for the profile being switched away from. The draft's own content reseed is
  // `useProfileDraft`'s job now, keyed on the same `profile.id`.
  useEffect(() => {
    setStatus('idle')
    clearPendingSave()
    setFilter('')
    setChangedOnly(false)
    setExpandedGroups(new Set())
    setConfirmResetAllOpen(false)
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
          // Revert the optimistic patch: unlike a plain `useState` (which would self-correct on
          // every remount), the shared draft (story 009 D6) survives a tab switch, so a failed save
          // would otherwise leave a phantom edit in the draft - and therefore in the validator -
          // indefinitely (review finding).
          patch({ cvars: profile.cvars })
          setStatus('idle')
        }
      })
    }, SAVE_DEBOUNCE_MS)
  }

  // Functional form: reads `prev.cvars` at commit time rather than the `draft` closure captured
  // when this callback was created, so two edits landing in the same tick can never lose one of
  // them (same guarantee a plain `setLocalCvars(prev => ...)` had - review finding).
  const handleChange = (name: string, value: string): void => {
    patch((prev) => {
      const next = { ...prev.cvars, [name]: value }
      scheduleSave(next)
      return { cvars: next }
    })
  }

  // One `buildCvarGroups` call per group, each scoped to that group's own defs and its own
  // Advanced-expand state: `buildCvarGroups` takes a single `showAdvanced` for the whole call, and
  // the Advanced collapse here is a per-group affordance, not a catalogue-wide one. `total`/
  // `changed` still come out right per group because `buildCvarGroups` computes them over the defs
  // it is given, before filter/changedOnly/showAdvanced are applied.
  const groupResults = useMemo<CvarGroupResult[]>(() => {
    return GROUP_ORDER.map((group) => {
      const groupDefs = ALL_CVARS.filter((def) => def.group === group)
      const results = buildCvarGroups(groupDefs, {
        values: draft.cvars,
        engine,
        filter,
        // `cvar-rows.ts` stays i18n-free (like every other `lib/*.ts` file here); resolving
        // `labelKey`/`descriptionKey` to the English text a user would actually type is this
        // component's job, since it already holds `t` (sprint decision: filter matches cvar name,
        // label and description, not their i18n keys - review finding).
        labelText: (def) => t(def.labelKey),
        descriptionText: (def) => t(def.descriptionKey),
        changedOnly,
        showAdvanced: expandedGroups.has(group),
      })
      return results.find((result) => result.group === group)!
    })
  }, [draft.cvars, engine, filter, changedOnly, expandedGroups, t])

  const catalogTotal = groupResults.reduce((sum, group) => sum + group.total, 0)
  const catalogChanged = groupResults.reduce((sum, group) => sum + group.changed, 0)

  const toggleAdvanced = (group: CvarDef['group']): void => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const handleResetAll = (): void => {
    patch((prev) => {
      // Only the catalogue's own keys are cleared - `prev.cvars` is spread first so an imported
      // cvar outside `ALL_CVARS` (visible on the Raw File tab) survives untouched (story 021
      // Decisions: a full `{}` would silently delete values this tab never showed). Deleting the key
      // rather than writing `effectiveDefaultFor(def, engine)` into it (review finding) matters for
      // three reasons: it never bakes an engine-scoped number into the profile that would go stale
      // if the engine scope changes afterward; it does not create an explicit line for a cvar the
      // profile never had; and it never writes a value for a row whose own per-row reset is disabled
      // because the cvar is absent on the scoped engine.
      const next = { ...prev.cvars }
      for (const def of ALL_CVARS) {
        delete next[def.name]
      }
      scheduleSave(next)
      return { cvars: next }
    })
    setConfirmResetAllOpen(false)
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-raised/60 px-3 py-2.5">
        <span className="shrink-0 text-xs text-ink-muted">
          {t('config.settings.header.count', { total: catalogTotal, changed: catalogChanged })}
        </span>
        <Input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('config.settings.header.filterPlaceholder')}
          aria-label={t('config.settings.header.filterPlaceholder')}
          className="h-8 min-w-40 flex-1"
        />
        <Switch
          checked={changedOnly}
          onChange={setChangedOnly}
          label={t('config.settings.header.changedOnly')}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={catalogChanged === 0}
          onClick={() => setConfirmResetAllOpen(true)}
        >
          {t('config.settings.header.resetAll')}
        </Button>
      </div>

      <div className="space-y-6">
        {groupResults.map((group) => (
          <section key={group.group}>
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-panel px-1 py-2">
              <span className="font-display text-xs tracking-[0.06em] text-ink-dim uppercase">
                {t(GROUP_LABEL_KEY[group.group])}
              </span>
              <span className="numeric text-xs text-ink-faint">
                {t('config.settings.header.count', { total: group.total, changed: group.changed })}
              </span>
            </div>

            <div>
              {group.rows.map(({ def }) => (
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

            {group.hasAdvanced && (
              // Gated on `hasAdvanced` (does this group have an advanced section at all), not on
              // `advancedHidden > 0` (how many rows the collapse is hiding *right now*) - the latter
              // legitimately reads 0 once the group is expanded, which used to make this button
              // disappear and leave no way back to the collapsed state (review finding). The "N
              // more" count itself still comes from `advancedHidden`, post-filter/changedOnly, and is
              // simply omitted when it would misleadingly read 0 or when the section is expanded.
              <button
                type="button"
                onClick={() => toggleAdvanced(group.group)}
                className="w-full rounded-sm px-1 py-1.5 text-left text-xs text-ink-muted transition-colors duration-[--dur-fast] hover:text-ink"
              >
                {expandedGroups.has(group.group)
                  ? t('config.settings.advanced.hide')
                  : group.advancedHidden > 0
                    ? t('config.settings.advanced.show', { count: group.advancedHidden })
                    : t('config.settings.advanced.showAdvanced')}
              </button>
            )}
          </section>
        ))}
      </div>

      <p className="flex flex-wrap items-center gap-4 text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-0.5 bg-flame-600" />
          {t('config.settings.legend.changed')}
        </span>
        <span>{t('config.settings.legend.default')}</span>
      </p>

      {confirmResetAllOpen && (
        <Modal
          open
          size="sm"
          title={t('config.settings.resetAllDialog.title')}
          onClose={() => setConfirmResetAllOpen(false)}
          closeLabel={t('common.close')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmResetAllOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={handleResetAll}>
                {t('config.settings.resetAllDialog.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-dim">
            {t('config.settings.resetAllDialog.body', { count: catalogChanged })}
          </p>
        </Modal>
      )}
    </div>
  )
}
