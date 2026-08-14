import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilePlus2, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { cn } from '../../lib/cn'
import { formatRelativeTime } from '../../lib/format'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState, KeyValue, Panel, SectionLabel } from '../../components/ui/primitives'
import { CreateProfileDialog } from './CreateProfileDialog'
import { DeleteProfileDialog } from './DeleteProfileDialog'
import { InstallationProfilesPanel } from './InstallationProfilesPanel'
import { ProfileAssignmentsPanel } from './ProfileAssignmentsPanel'
import { RenameProfileDialog } from './RenameProfileDialog'
import { listConfigProfiles } from './client'

/**
 * The config module's view: every persisted config profile in a master/detail
 * layout, so later stories (installation assignment, cvar/bind editing) can hang
 * new sections into the detail pane without re-laying out the view.
 */
export function ConfigView() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<ConfigProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listConfigProfiles().then((result) => {
      if (!cancelled && result.ok) setProfiles(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedId(null)
      return
    }
    if (!profiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(profiles[0].id)
    }
  }, [profiles, selectedId])

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null

  /**
   * `create` returns the full updated list rather than just the new profile, so
   * the newly-created one is whichever id in the response was not already in
   * `profiles` - reliable regardless of naming, since ids are always unique.
   */
  const handleCreated = (updated: ConfigProfile[]): void => {
    const previousIds = new Set(profiles.map((profile) => profile.id))
    const created = updated.find((profile) => !previousIds.has(profile.id))
    setProfiles(updated)
    setSelectedId(created?.id ?? updated[updated.length - 1]?.id ?? null)
    setShowCreate(false)
  }

  /**
   * Rename/remove both return the full updated list too. Selection repair
   * (falling back to `profiles[0]` or `null`) is handled by the effect above
   * once `profiles` is updated - neither handler needs to touch `selectedId`.
   */
  const handleRenamed = (updated: ConfigProfile[]): void => {
    setProfiles(updated)
    setShowRename(false)
  }

  const handleDeleted = (updated: ConfigProfile[]): void => {
    setProfiles(updated)
    setShowDelete(false)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,220px)_1fr]">
            <Panel className="p-2">
              <SectionLabel className="px-2 pt-1 pb-2">{t('config.list.label')}</SectionLabel>
              <ul className="space-y-1">
                {profiles.map((profile) => (
                  <li key={profile.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(profile.id)}
                      className={cn(
                        'w-full truncate rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-[--dur-fast]',
                        profile.id === selectedId
                          ? 'bg-flame-900/30 text-flame-200'
                          : 'text-ink-dim hover:bg-hover hover:text-ink',
                      )}
                    >
                      {profile.name}
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel className="space-y-4 p-4">
              {selected && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-lg tracking-[0.06em] text-ink uppercase">
                      {selected.name}
                    </h2>
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
                  <div className="space-y-2">
                    <KeyValue label={t('config.detail.created')}>
                      {formatRelativeTime(selected.createdAt) ?? '-'}
                    </KeyValue>
                    <KeyValue label={t('config.detail.updated')}>
                      {formatRelativeTime(selected.updatedAt) ?? '-'}
                    </KeyValue>
                  </div>
                  <ProfileAssignmentsPanel profile={selected} onChanged={setProfiles} />
                </>
              )}
            </Panel>
          </div>
        )}

        <Panel className="space-y-3 p-4">
          <InstallationProfilesPanel profiles={profiles} />
        </Panel>
      </div>

      {showCreate && (
        <CreateProfileDialog onClose={() => setShowCreate(false)} onCreated={handleCreated} />
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
    </div>
  )
}
