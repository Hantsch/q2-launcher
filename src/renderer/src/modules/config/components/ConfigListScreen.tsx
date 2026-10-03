import { useTranslation } from 'react-i18next'
import { ChevronRight, FilePlus2, SlidersHorizontal } from 'lucide-react'
import { formatRelativeTime } from '../../../lib/format'
import { Button } from '../../../components/ui/Button'
import { EmptyState, Panel, SectionLabel } from '../../../components/ui/primitives'
import { useConfigProfiles } from '../config-profiles-store'
import { InstallationProfilesPanel } from '../InstallationProfilesPanel'

/** The landing state of the config module: "what configs do I have". (story 218) */
export function ConfigListScreen({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const { t } = useTranslation()
  const profiles = useConfigProfiles((s) => s.profiles)

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('common.label.config')}
          </h1>
          <p className="text-xs text-ink-muted">
            {t('config.subtitle', { count: profiles.length })}
          </p>
        </div>

        <Button
          variant="neutral"
          size="sm"
          data-testid="config-create-profile"
          icon={<FilePlus2 className="size-3.5" />}
          onClick={onCreate}
        >
          {t('config.newProfile')}
        </Button>
      </header>

      {profiles.length === 0 ? (
        <Panel className="mt-6">
          <EmptyState
            icon={<SlidersHorizontal className="size-6" />}
            title={t('common.label.noConfigProfiles')}
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
                    data-testid="config-profile-row"
                    onClick={() => onOpen(profile.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-sm px-3 py-3.5 text-left transition-colors duration-[--dur-fast] hover:bg-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{profile.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {t('config.detail.updated')}: {formatRelativeTime(profile.updatedAt) ?? '-'}
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
  )
}
