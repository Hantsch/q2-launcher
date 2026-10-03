import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import type { Outcome } from '@shared/types'
import type { ExtraFoldersResult, ReplaysModWarning } from '@shared/modules/replays'
import { invoke } from '../../lib/bridge'
import { useModuleMutation, useModuleQuery } from '../../lib/useModuleQuery'
import { Button, IconButton } from '../../components/ui/Button'
import { Switch } from '../../components/ui/controls'
import { SectionLabel } from '../../components/ui/primitives'
import {
  addExtraFolder,
  listExtraFolders,
  readModWarning,
  removeExtraFolder,
  resetModWarningTrusted,
  setModWarningEnabled,
} from './client'
import { NameTemplatesList } from './NameTemplatesList'

/**
 * Story 142 D4: the extra-demo-folders list a user actually edits - a sibling block to
 * `NameTemplatesList` in the same Settings section, mirroring `servers/ServersSettingsSection.tsx`'s
 * `mutate()`-through-`Outcome` discipline: every mutating action re-renders from the handler's
 * returned full list, never an optimistic local copy.
 */
function ExtraFoldersList() {
  const { t } = useTranslation()
  const query = useModuleQuery(listExtraFolders)
  const mutation = useModuleMutation((action: () => Promise<Outcome<ExtraFoldersResult>>) =>
    action(),
  )
  const folders = query.data ?? null
  const busy = mutation.busy
  const error = mutation.error ?? (query.state === 'error' ? query.error : null)
  const { setData: setFolders } = query

  /** Every `extraFolders.*` mutation goes through here: main's returned full list replaces the
   * view; a refusal or transport failure becomes the shown error, never raw prose (CLAUDE.md). */
  const mutate = async (action: () => Promise<Outcome<ExtraFoldersResult>>): Promise<void> => {
    const result = await mutation.run(action)
    if (result?.ok) setFolders(result.folders)
  }

  const handleAdd = async (): Promise<void> => {
    const picked = await invoke('installations:pickFolder', {
      title: t('replays.extraFolders.pickTitle'),
    })
    if (!picked) return
    await mutate(() => addExtraFolder(picked))
  }

  const handleRemove = (id: string): void => {
    void mutate(() => removeExtraFolder(id))
  }

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <SectionLabel>{t('replays.extraFolders.heading')}</SectionLabel>

      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="replays-extra-folders-error">
          {t(error.key, error.params)}
        </p>
      )}

      {folders && folders.length === 0 && (
        <p className="text-xs text-ink-muted">{t('replays.extraFolders.empty')}</p>
      )}

      {folders && folders.length > 0 && (
        <div className="space-y-1.5">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center gap-2"
              data-testid="replays-extra-folder-row"
            >
              <p className="min-w-0 flex-1 truncate text-sm text-ink">{folder.path}</p>
              <IconButton
                label={t('replays.extraFolders.remove', { path: folder.path })}
                size="sm"
                variant="ghost"
                onClick={() => handleRemove(folder.id)}
                disabled={busy}
                data-testid="replays-extra-folder-remove"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="neutral"
        onClick={() => void handleAdd()}
        disabled={busy}
        data-testid="replays-extra-folders-add"
      >
        {t('replays.extraFolders.add')}
      </Button>
    </div>
  )
}

/**
 * Story 182 D3: the missing-mod warning's switch and its remembered mods, a sibling of
 * `ExtraFoldersList` with the same discipline: every action re-renders from the handler's returned
 * full state, never an optimistic local copy.
 */
function ModWarningSettings() {
  const { t } = useTranslation()
  const query = useModuleQuery(readModWarning)
  const mutation = useModuleMutation((action: () => Promise<Outcome<ReplaysModWarning>>) =>
    action(),
  )
  const state = query.data ?? null
  const busy = mutation.busy
  const error = mutation.error ?? (query.state === 'error' ? query.error : null)
  const { setData: setState } = query

  const mutate = async (action: () => Promise<Outcome<ReplaysModWarning>>): Promise<void> => {
    const result = await mutation.run(action)
    if (result) setState(result)
  }

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <SectionLabel>{t('replays.modWarning.heading')}</SectionLabel>

      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="replays-mod-warning-error">
          {t(error.key, error.params)}
        </p>
      )}

      <Switch
        testId="replays-mod-warning-enabled"
        label={t('replays.modWarning.enabled')}
        checked={state?.enabled ?? true}
        disabled={!state || busy}
        onChange={(enabled) => void mutate(() => setModWarningEnabled(enabled))}
      />

      {state && (
        <p className="text-xs text-ink-muted" data-testid="replays-mod-warning-trusted">
          {state.trustedMods.length === 0
            ? t('replays.modWarning.trustedEmpty')
            : `${t('replays.modWarning.trustedHeading')}: ${state.trustedMods.join(', ')}`}
        </p>
      )}

      <Button
        variant="neutral"
        onClick={() => void mutate(resetModWarningTrusted)}
        disabled={!state || state.trustedMods.length === 0 || busy}
        data-testid="replays-mod-warning-reset"
      >
        {t('replays.modWarning.reset')}
      </Button>
    </div>
  )
}

/**
 * Story 135 D3: the replays module's Settings section - inner content only, the shell
 * (`SettingsView.tsx`) already wraps every contributed section in its own `Panel` + `SectionLabel`
 * chrome, same as `servers/ServersSettingsSection.tsx`.
 *
 * Story 140 D3 replaces the placeholder paragraph with the naming-pattern list a user actually
 * edits (`NameTemplatesList`) - the module's first real control, mirroring story 111 D4's own
 * replacement of `servers-settings-placeholder`.
 *
 * Story 142 D4 adds `ExtraFoldersList` as a sibling block below it - the second real control in
 * this section.
 */
export function ReplaysSettingsSection() {
  return (
    <>
      <NameTemplatesList />
      <ExtraFoldersList />
      <ModWarningSettings />
    </>
  )
}
