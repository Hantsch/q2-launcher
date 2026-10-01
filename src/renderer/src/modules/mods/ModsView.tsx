import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes } from 'lucide-react'
import type { ModActiveInstall, ModCatalogState, ModGameDir } from '@shared/modules/mods'
import { isJobActive, type LocalizedMessage } from '@shared/types'
import { EmptyState } from '../../components/ui/primitives'
import { useActiveInstallation, useLauncher } from '../../store/useLauncher'
import { ModDetailPanel } from './components/ModDetailPanel'
import { ModTile } from './components/ModTile'
import {
  InstallDecisionDialog,
  type InstallDecisionRequest,
} from './components/InstallDecisionDialog'
import { getCatalog, installMod, listMods, onInstallDecision } from './client'
import { mergeModTiles } from './merge-mod-tiles'
import { useModUpdate } from './useModUpdate'

type ListState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      installationId: string
      gameDirs: ModGameDir[]
      activeInstalls: ModActiveInstall[]
    }
  | { kind: 'error'; installationId: string; error: LocalizedMessage }

/** The game directories of the active installation, read through `mods/list` (never the store). */
export function ModsView() {
  const { t, i18n } = useTranslation()
  const installation = useActiveInstallation()
  const installationId = installation?.id ?? null
  // Re-list when the installation's directories change (rescan, add, remove).
  const dirsKey = installation ? installation.gameDirs.join('\n') : ''
  const [loaded, setState] = useState<ListState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  // Installs this view started (catalogId -> jobId), refusals, and the decision a job waits on.
  const [started, setStarted] = useState<Record<string, string>>({})
  const [failures, setFailures] = useState<Record<string, LocalizedMessage>>({})
  const [decisionEvent, setDecisionEvent] = useState<InstallDecisionRequest | null>(null)
  const [answered, setAnswered] = useState<string[]>([])
  const [removeStarted, setRemoveStarted] = useState<string[]>([])
  const jobs = useLauncher((s) => s.jobs)
  // A result for another installation is not this one's: treat it as still loading.
  const state: ListState =
    loaded.kind !== 'loading' && loaded.installationId !== installationId
      ? { kind: 'loading' }
      : loaded

  // The catalog is fetched once per view; `unavailable` also covers a failed call.
  const [catalog, setCatalog] = useState<ModCatalogState | null>(null)
  useEffect(() => {
    let stale = false
    getCatalog()
      .then((outcome) => (outcome.ok ? outcome.value : ({ status: 'unavailable' } as const)))
      .catch(() => ({ status: 'unavailable' }) as const)
      .then((next) => {
        if (!stale) setCatalog(next)
      })
    return () => {
      stale = true
    }
  }, [])
  const activeInstalls = useMemo(
    () => (state.kind === 'ready' ? state.activeInstalls : []),
    [state],
  )
  const gameDirs = state.kind === 'ready' ? state.gameDirs : null
  const tiles = useMemo(
    () =>
      gameDirs ? mergeModTiles(catalog?.status === 'ok' ? catalog.entries : [], gameDirs) : [],
    [catalog, gameDirs],
  )
  const asOf =
    catalog?.status === 'ok' && catalog.fromCache
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
          new Date(catalog.fetchedAt),
        )
      : null

  // The selection is keyed to its installation and only counts while the directory is listed.
  const [selected, setSelectedRaw] = useState<{ installationId: string; gameDir: string } | null>(
    null,
  )
  const selectedMod =
    selected?.installationId === installationId
      ? (tiles.find((tile) => tile.gameDir === selected.gameDir) ?? null)
      : null
  const setSelected = useCallback(
    (gameDir: string) => {
      if (installationId) setSelectedRaw({ installationId, gameDir })
    },
    [installationId],
  )
  const jobFor = useCallback(
    (catalogId: string) => {
      const jobId =
        started[catalogId] ?? activeInstalls.find((a) => a.catalogId === catalogId)?.jobId
      return (jobId && jobs.find((job) => job.id === jobId)) || null
    },
    [started, activeInstalls, jobs],
  )

  // A tracked job that ends is final: refetch the list (the record, or nothing, is the truth).
  useEffect(() => {
    const done = Object.entries(started).filter(([, jobId]) => {
      const job = jobs.find((j) => j.id === jobId)
      return job !== undefined && !isJobActive(job)
    })
    if (done.length === 0) return
    setReloadKey((n) => n + 1)
    setFailures((prev) => {
      const next = { ...prev }
      for (const [catalogId, jobId] of done) {
        const job = jobs.find((j) => j.id === jobId)
        if (job?.status === 'failed' && job.error) next[catalogId] = job.error
      }
      return next
    })
    setStarted((prev) => {
      const next = { ...prev }
      for (const [catalogId] of done) delete next[catalogId]
      return next
    })
  }, [started, jobs])

  // A removal this view started that ends is final too: refetch the list.
  useEffect(() => {
    const done = removeStarted.filter((jobId) => {
      const job = jobs.find((j) => j.id === jobId)
      return job !== undefined && !isJobActive(job)
    })
    if (done.length === 0) return
    setReloadKey((n) => n + 1)
    setRemoveStarted((prev) => prev.filter((id) => !done.includes(id)))
  }, [removeStarted, jobs])
  const removeJobFor = (catalogId: string | undefined) =>
    (catalogId &&
      jobs.find(
        (j) =>
          j.kind === 'mods-remove' &&
          j.installationId === installationId &&
          j.labelParams?.mod === catalogId &&
          isJobActive(j),
      )) ||
    null

  useEffect(
    () =>
      onInstallDecision((event) => {
        if (event.installationId === installationId) setDecisionEvent(event)
      }),
    [installationId],
  )
  const fromList = activeInstalls.find((a) => a.decision && !answered.includes(a.jobId))
  const decision: InstallDecisionRequest | null =
    decisionEvent && !answered.includes(decisionEvent.jobId)
      ? decisionEvent
      : fromList?.decision
        ? { jobId: fromList.jobId, ...fromList.decision }
        : null

  const install = useCallback(
    async (catalogId: string, version?: string): Promise<void> => {
      if (!installationId) return
      setFailures(({ [catalogId]: _dropped, ...rest }) => rest)
      const outcome = await installMod(installationId, catalogId, version)
      if (outcome.ok) {
        setStarted((prev) => ({ ...prev, [catalogId]: outcome.value.jobId }))
        setReloadKey((n) => n + 1)
      } else {
        setFailures((prev) => ({ ...prev, [catalogId]: outcome.error }))
      }
    },
    [installationId],
  )
  const onUpdateStarted = useCallback((catalogId: string, jobId: string) => {
    setFailures(({ [catalogId]: _dropped, ...rest }) => rest)
    setStarted((prev) => ({ ...prev, [catalogId]: jobId }))
    setReloadKey((n) => n + 1)
  }, [])
  const onUpdateFailed = useCallback((catalogId: string, error: LocalizedMessage) => {
    setFailures((prev) => ({ ...prev, [catalogId]: error }))
  }, [])
  const { requestUpdate, dialog: updateDialog } = useModUpdate(
    installationId,
    onUpdateStarted,
    onUpdateFailed,
  )
  // Any install, removal or update running for this installation makes Update wait.
  const busy =
    Object.keys(started).length > 0 ||
    removeStarted.length > 0 ||
    jobs.some(
      (j) =>
        j.installationId === installationId &&
        ['mod-install', 'mods-remove', 'mod-update'].includes(j.kind) &&
        isJobActive(j),
    )
  const closePanel = useCallback(() => setSelectedRaw(null), [])

  useEffect(() => {
    if (!installationId) return
    let stale = false
    void listMods(installationId).then((outcome) => {
      if (stale) return
      setState(
        outcome.ok
          ? {
              kind: 'ready',
              installationId,
              gameDirs: outcome.value.gameDirs,
              activeInstalls: outcome.value.activeInstalls,
            }
          : { kind: 'error', installationId, error: outcome.error },
      )
    })
    return () => {
      stale = true
    }
  }, [installationId, dirsKey, reloadKey])

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
          ) : state.kind === 'ready' ? (
            <div className="space-y-3">
              {catalog?.status === 'unavailable' && (
                <p className="text-sm text-ink-dim" data-testid="mods-catalog-unavailable">
                  {t('mods.catalog.unavailable')}
                </p>
              )}
              {asOf && (
                <p className="text-sm text-ink-dim" data-testid="mods-catalog-as-of">
                  {t('mods.catalog.asOf', { date: asOf })}
                </p>
              )}
              {tiles.length === 0 ? (
                <div data-testid="mods-empty">
                  <EmptyState
                    icon={<Boxes className="size-6" />}
                    title={t('mods.empty.title')}
                    body={t('mods.empty.body')}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
                  {tiles.map((mod) => (
                    <ModTile
                      key={mod.gameDir}
                      mod={mod}
                      selected={mod.gameDir === selectedMod?.gameDir}
                      onSelect={setSelected}
                      job={mod.catalog ? jobFor(mod.catalog.id) : null}
                      failure={mod.catalog ? (failures[mod.catalog.id] ?? null) : null}
                      onInstall={(catalogId) => void install(catalogId)}
                      onUpdate={requestUpdate}
                      busy={busy}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
        {installation && selectedMod && (
          <ModDetailPanel
            installationId={installation.id}
            mod={selectedMod}
            onClose={closePanel}
            job={selectedMod.catalog ? jobFor(selectedMod.catalog.id) : null}
            failure={selectedMod.catalog ? (failures[selectedMod.catalog.id] ?? null) : null}
            onInstall={(catalogId, version) => void install(catalogId, version)}
            removeJob={removeJobFor(selectedMod.local?.catalogId)}
            onRemoveStarted={(jobId) => setRemoveStarted((prev) => [...prev, jobId])}
            busy={busy}
            onUpdateStarted={onUpdateStarted}
            onUpdateFailed={onUpdateFailed}
          />
        )}
      </div>
      {updateDialog}
      {decision && (
        <InstallDecisionDialog
          request={decision}
          onAnswered={(jobId) => {
            setAnswered((prev) => [...prev, jobId])
            setDecisionEvent(null)
          }}
        />
      )}
    </div>
  )
}
