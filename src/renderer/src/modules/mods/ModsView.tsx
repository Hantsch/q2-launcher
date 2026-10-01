import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes } from 'lucide-react'
import type { ModGameDir } from '@shared/modules/mods'
import type { LocalizedMessage } from '@shared/types'
import { EmptyState } from '../../components/ui/primitives'
import { useActiveInstallation } from '../../store/useLauncher'
import { ModDetailPanel } from './components/ModDetailPanel'
import { ModTile } from './components/ModTile'
import { listMods } from './client'

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; installationId: string; gameDirs: ModGameDir[] }
  | { kind: 'error'; installationId: string; error: LocalizedMessage }

/** The game directories of the active installation, read through `mods/list` (never the store). */
export function ModsView() {
  const { t } = useTranslation()
  const installation = useActiveInstallation()
  const installationId = installation?.id ?? null
  // Re-list when the installation's directories change (rescan, add, remove).
  const dirsKey = installation ? installation.gameDirs.join('\n') : ''
  const [loaded, setState] = useState<ListState>({ kind: 'loading' })
  // A result for another installation is not this one's: treat it as still loading.
  const state: ListState =
    loaded.kind !== 'loading' && loaded.installationId !== installationId
      ? { kind: 'loading' }
      : loaded

  // The selection is keyed to its installation and only counts while the directory is listed.
  const [selected, setSelectedRaw] = useState<{ installationId: string; gameDir: string } | null>(
    null,
  )
  const selectedMod =
    state.kind === 'ready' && selected?.installationId === installationId
      ? (state.gameDirs.find((mod) => mod.gameDir === selected.gameDir) ?? null)
      : null
  const setSelected = useCallback(
    (gameDir: string) => {
      if (installationId) setSelectedRaw({ installationId, gameDir })
    },
    [installationId],
  )
  const closePanel = useCallback(() => setSelectedRaw(null), [])

  useEffect(() => {
    if (!installationId) return
    let stale = false
    void listMods(installationId).then((outcome) => {
      if (stale) return
      setState(
        outcome.ok
          ? { kind: 'ready', installationId, gameDirs: outcome.value.gameDirs }
          : { kind: 'error', installationId, error: outcome.error },
      )
    })
    return () => {
      stale = true
    }
  }, [installationId, dirsKey])

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('module.mods.title')}
          </h1>
          {installation && (
            <p className="text-sm text-ink-dim" data-testid="mods-installation-name">
              {t('mods.view.forInstallation', { name: installation.name })}
            </p>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
          {!installation ? (
            <div data-testid="mods-no-installation">
              <EmptyState
                icon={<Boxes className="size-6" />}
                title={t('mods.noInstallation.title')}
                body={t('mods.noInstallation.body')}
              />
            </div>
          ) : state.kind === 'error' ? (
            <p role="alert" className="text-sm text-danger" data-testid="mods-error">
              {t(state.error.key, state.error.params)}
            </p>
          ) : state.kind === 'ready' && state.gameDirs.length === 0 ? (
            <div data-testid="mods-empty">
              <EmptyState
                icon={<Boxes className="size-6" />}
                title={t('mods.empty.title')}
                body={t('mods.empty.body')}
              />
            </div>
          ) : state.kind === 'ready' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
              {state.gameDirs.map((mod) => (
                <ModTile
                  key={mod.gameDir}
                  mod={mod}
                  selected={mod.gameDir === selectedMod?.gameDir}
                  onSelect={setSelected}
                />
              ))}
            </div>
          ) : null}
        </div>
        {installation && selectedMod && (
          <ModDetailPanel installationId={installation.id} mod={selectedMod} onClose={closePanel} />
        )}
      </div>
    </div>
  )
}
