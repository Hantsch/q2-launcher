import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight, FilePlus2, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { formatRelativeTime } from '../../lib/format'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState, KeyValue, Panel, SectionLabel } from '../../components/ui/primitives'
import { AssignmentsMenu } from './AssignmentsMenu'
import { CreateProfileDialog } from './CreateProfileDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { ImportProfileDialog } from './ImportProfileDialog'
import { InstallationProfilesPanel } from './InstallationProfilesPanel'
import { LayersPanel } from './LayersPanel'
import { OverviewKeyboardPanel } from './OverviewKeyboardPanel'
import { PreservedLinesPanel } from './PreservedLinesPanel'
import { PreviewProfileDialog } from './PreviewProfileDialog'
import { RenameProfileDialog } from './RenameProfileDialog'
import { SettingsTab } from './SettingsTab'
import { WriteTargets } from './WriteTargets'
import { listConfigProfiles } from './client'

type Screen = 'list' | 'detail'
type DetailTab = 'overview' | 'settings' | 'writeTargets' | 'preserved'

/**
 * The config module's view: a list of profiles first, so "what configs do I
 * have" is the landing state rather than one profile's editor - selecting a
 * profile navigates into its detail (tabs, starting on the keyboard overview
 * per CFG-7), with a back button rather than a permanent master/detail split.
 */
export function ConfigView() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ConfigProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('list')
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [previewInstallationId, setPreviewInstallationId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listConfigProfiles().then((result) => {
      if (!cancelled && result.ok) setProfiles(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A profile that disappears out from under an open detail view (deleted,
  // or gone after a reload) sends the view back to the list rather than
  // rendering a detail screen for nothing.
  useEffect(() => {
    if (selectedId && !profiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(null)
      setScreen('list')
    }
  }, [profiles, selectedId])

  useEffect(() => {
    setActiveLayerId(null)
  }, [selectedId])

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null
  const activeLayer = selected?.layers?.find((layer) => layer.id === activeLayerId) ?? null

  const openProfile = (id: string): void => {
    setSelectedId(id)
    setActiveTab('overview')
    setScreen('detail')
  }

  const backToList = (): void => {
    setScreen('list')
  }

  /**
   * `create` returns the full updated list rather than just the new profile, so
   * the newly-created one is whichever id in the response was not already in
   * `profiles` - reliable regardless of naming, since ids are always unique.
   *
   * Shared verbatim by `ImportProfileDialog` (`import.commit` returns the same
   * "full updated list" shape, per its contract) - it closes both dialogs
   * rather than knowing which one is currently open, since only one of them
   * can be mounted at a time anyway. A successful create/import navigates
   * straight into the new profile, since there is nothing useful to look at
   * on the list for it yet.
   */
  const handleCreated = (updated: ConfigProfile[]): void => {
    const previousIds = new Set(profiles.map((profile) => profile.id))
    const created = updated.find((profile) => !previousIds.has(profile.id))
    setProfiles(updated)
    setShowCreate(false)
    setShowImport(false)
    const target = created ?? updated[updated.length - 1]
    if (target) openProfile(target.id)
  }

  const handleRenamed = (updated: ConfigProfile[]): void => {
    setProfiles(updated)
    setShowRename(false)
  }

  const handleDeleted = (updated: ConfigProfile[]): void => {
    setProfiles(updated)
    setShowDelete(false)
    setSelectedId(null)
    setScreen('list')
  }

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: t('config.tabs.overview') },
    { id: 'settings', label: t('config.tabs.settings') },
    { id: 'writeTargets', label: t('config.tabs.writeTargets') },
    ...(selected?.unrecognized?.length
      ? [{ id: 'preserved' as const, label: t('config.tabs.preserved') }]
      : []),
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[92rem] space-y-6 p-8">
        {screen === 'list' && (
          <>
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
                  {t('config.title')}
                </h1>
                <p className="text-xs text-ink-muted">
                  {t('config.subtitle', { count: profiles.length })}
                </p>
              </div>

              <Button
                variant="neutral"
                size="sm"
                icon={<FilePlus2 className="size-3.5" />}
                onClick={() => setShowCreate(true)}
              >
                {t('config.newProfile')}
              </Button>
            </header>

            {profiles.length === 0 ? (
              <Panel className="mt-6">
                <EmptyState
                  icon={<SlidersHorizontal className="size-6" />}
                  title={t('config.empty.title')}
                  body={t('config.empty.body')}
                  hint={t('config.empty.hint')}
                />
              </Panel>
            ) : (
              <>
                <Panel className="p-3">
                  <SectionLabel className="px-2 pt-1 pb-2">{t('config.list.label')}</SectionLabel>
                  <ul className="divide-y divide-line">
                    {profiles.map((profile) => (
                      <li key={profile.id}>
                        <button
                          type="button"
                          onClick={() => openProfile(profile.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-3.5 text-left transition-colors duration-[--dur-fast] hover:bg-hover"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink">{profile.name}</span>
                            <span className="block text-xs text-ink-muted">
                              {t('config.detail.updated')}:{' '}
                              {formatRelativeTime(profile.updatedAt) ?? '-'}
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-ink-muted" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel className="space-y-3 p-6">
                  <InstallationProfilesPanel profiles={profiles} />
                </Panel>
              </>
            )}
          </>
        )}

        {screen === 'detail' && selected && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft className="size-3.5" />}
                onClick={backToList}
              >
                {t('config.nav.back')}
              </Button>
              <div className="flex items-center gap-2">
                <AssignmentsMenu profile={selected} onChanged={setProfiles} />
                <div className="flex items-center gap-1">
                  <IconButton
                    label={t('config.detail.rename')}
                    size="sm"
                    onClick={() => setShowRename(true)}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.detail.delete')}
                    size="sm"
                    variant="danger"
                    onClick={() => setShowDelete(true)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-lg tracking-[0.06em] text-ink uppercase">
                {selected.name}
              </h2>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <KeyValue label={t('config.detail.created')}>
                  {formatRelativeTime(selected.createdAt) ?? '-'}
                </KeyValue>
                <KeyValue label={t('config.detail.updated')}>
                  {formatRelativeTime(selected.updatedAt) ?? '-'}
                </KeyValue>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b border-line pb-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'rounded-sm px-2.5 py-1.5 text-xs font-medium transition-colors duration-[--dur-fast]',
                    activeTab === tab.id
                      ? 'bg-flame-900/30 text-flame-200'
                      : 'text-ink-dim hover:bg-hover hover:text-ink',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <Panel className="p-6">
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <LayersPanel
                    profile={selected}
                    activeLayerId={activeLayerId}
                    onSelectLayer={setActiveLayerId}
                    onChanged={setProfiles}
                  />
                  <OverviewKeyboardPanel
                    profile={selected}
                    activeLayer={activeLayer}
                    onChanged={setProfiles}
                  />
                </div>
              )}
              {activeTab === 'settings' && (
                <SettingsTab profile={selected} onChanged={setProfiles} />
              )}
              {activeTab === 'writeTargets' && (
                <WriteTargets profile={selected} onPreview={setPreviewInstallationId} />
              )}
              {activeTab === 'preserved' && <PreservedLinesPanel profile={selected} />}
            </Panel>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProfileDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          onWantImport={() => {
            setShowCreate(false)
            setShowImport(true)
          }}
        />
      )}

      {showImport && (
        <ImportProfileDialog onClose={() => setShowImport(false)} onCreated={handleCreated} />
      )}

      {showRename && selected && (
        <RenameProfileDialog
          profile={selected}
          onClose={() => setShowRename(false)}
          onRenamed={handleRenamed}
        />
      )}

      {showDelete && selected && (
        <DeleteProfileDialog
          profile={selected}
          onClose={() => setShowDelete(false)}
          onDeleted={handleDeleted}
        />
      )}

      {previewInstallationId && selected && (
        <PreviewProfileDialog
          profile={selected}
          installationId={previewInstallationId}
          onClose={() => setPreviewInstallationId(null)}
        />
      )}
    </div>
  )
}
