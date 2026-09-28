import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import type { LocalizedMessage, Outcome } from '@shared/types'
import type { ExtraFoldersResult, ReplaysExtraFolder } from '@shared/modules/replays'
import { invoke } from '../../lib/bridge'
import { Button, IconButton } from '../../components/ui/Button'
import { SectionLabel } from '../../components/ui/primitives'
import { addExtraFolder, listExtraFolders, removeExtraFolder } from './client'
import { NameTemplatesList } from './NameTemplatesList'

/**
 * Story 142 D4: the extra-demo-folders list a user actually edits - a sibling block to
 * `NameTemplatesList` in the same Settings section, mirroring `servers/ServersSettingsSection.tsx`'s
 * `mutate()`-through-`Outcome` discipline: every mutating action re-renders from the handler's
 * returned full list, never an optimistic local copy.
 */
function ExtraFoldersList() {
  const { t } = useTranslation()
  const [folders, setFolders] = useState<ReplaysExtraFolder[] | null>(null)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listExtraFolders().then((result) => {
      if (cancelled) return
      if (result.ok) setFolders(result.value)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** Every `extraFolders.*` mutation goes through here: clears the previous error, runs the
   * action, and either applies main's returned full list (success) or renders the refusal's
   * reason - transport failure and domain refusal are two different shapes but both become the
   * same `error` state, never raw prose (CLAUDE.md). */
  const mutate = async (action: () => Promise<Outcome<ExtraFoldersResult>>): Promise<void> => {
    setError(null)
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const domain = result.value
    if (!domain.ok) {
      setError({ key: `replays.extraFolders.error.${domain.reason}` })
      return
    }
    setFolders(domain.folders)
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
    </>
  )
}
