import { useRef, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleSetting, MotionSetting } from '@shared/types'
import { useLauncher } from '../store/useLauncher'
import { SUPPORTED_LOCALES } from '../i18n'
import { AboutPanel } from '../components/about/AboutPanel'
import { AppVersionCard } from '../components/about/AppVersionCard'
import { DevToolsPanel } from '../components/settings/DevToolsPanel'
import { SettingsNav, type SettingsNavItem } from '../components/settings/SettingsNav'
import { SettingsSection } from '../components/settings/SettingsSection'
import { UnlockCodePanel } from '../components/unlock/UnlockCodePanel'
import { Select, Switch } from '../components/ui/controls'
import { Divider } from '../components/ui/primitives'
import { RENDERER_MODULES, type RendererModule } from '../modules'

const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
}

/** DOM id of a Settings section - the side nav's scroll target. */
const anchor = (id: string): string => `settings-anchor-${id}`

/**
 * Module-contributed sections, sorted by `order` then module id so a tie is
 * deterministic instead of depending on registration order in `modules/index.ts`.
 */
function settingsSections(modules: readonly RendererModule[]): Array<{
  id: string
  titleKey: string
  descriptionKey?: string
  order: number
  Section: ComponentType
}> {
  return modules
    .filter((module) => module.settingsSection !== undefined)
    .map((module) => ({
      id: module.id,
      titleKey: module.settingsSection!.titleKey,
      descriptionKey: module.settingsSection!.descriptionKey,
      order: module.settingsSection!.order,
      Section: module.settingsSection!.Section,
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export interface SettingsViewProps {
  /**
   * Defaults to the real registry. Overridable so tests can prove the
   * module-contributed-section mechanism with a stub module instead of
   * depending on a real one being registered.
   */
  modules?: readonly RendererModule[]
}

export function SettingsView(props: SettingsViewProps = {}) {
  const { modules = RENDERER_MODULES } = props
  const { t } = useTranslation()
  const settings = useLauncher((state) => state.settings)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const appInfo = useLauncher((state) => state.appInfo)
  const contributedSections = settingsSections(modules)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Same order as the sections below. The version card leads, so the running version and its
  // update state are the first thing this view shows.
  const navItems: SettingsNavItem[] = [
    { id: anchor('updates'), label: t('settings.nav.updates') },
    { id: anchor('appearance'), label: t('settings.section.appearance') },
    { id: anchor('launch'), label: t('settings.section.launch') },
    { id: anchor('library'), label: t('settings.section.library') },
    ...contributedSections.map(({ id, titleKey }) => ({ id: anchor(id), label: t(titleKey) })),
    { id: anchor('unlock'), label: t('settings.section.unlock') },
    { id: anchor('about'), label: t('settings.section.about') },
    ...(appInfo?.isDev ? [{ id: anchor('development'), label: t('settings.devTools') }] : []),
  ]

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scrollbar-gutter-stable">
      <div className="mx-auto flex max-w-4xl gap-8 p-6">
        <aside className="sticky top-6 hidden w-44 shrink-0 self-start pt-12 lg:block">
          <SettingsNav items={navItems} scrollRootRef={scrollRef} />
        </aside>

        <div className="min-w-0 flex-1 space-y-4" data-testid="settings-content">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('settings.title')}
          </h1>

          <AppVersionCard id={anchor('updates')} className="scroll-mt-6" />

          <SettingsSection
            id={anchor('appearance')}
            title={t('settings.section.appearance')}
            description={t('settings.sectionHint.appearance')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="stencil block">{t('settings.language')}</span>
                <Select
                  value={settings.locale}
                  onChange={(event) =>
                    void patchSettings({ locale: event.target.value as LocaleSetting })
                  }
                  options={[
                    { value: 'system', label: t('settings.languageSystem') },
                    ...SUPPORTED_LOCALES.map((locale) => ({
                      value: locale,
                      label: LOCALE_NAMES[locale] ?? locale,
                    })),
                  ]}
                />
              </label>

              <label className="space-y-1.5">
                <span className="stencil block">{t('settings.motion')}</span>
                <Select
                  value={settings.motion}
                  onChange={(event) =>
                    void patchSettings({ motion: event.target.value as MotionSetting })
                  }
                  options={[
                    { value: 'system', label: t('settings.motionSystem') },
                    { value: 'full', label: t('settings.motionFull') },
                    { value: 'reduced', label: t('settings.motionReduced') },
                  ]}
                />
              </label>
            </div>

            <p className="text-xs leading-relaxed text-ink-muted">{t('settings.languageNote')}</p>
          </SettingsSection>

          <SettingsSection
            id={anchor('launch')}
            title={t('settings.section.launch')}
            description={t('settings.sectionHint.launch')}
          >
            <div className="space-y-1">
              <Switch
                label={t('settings.minimizeOnLaunch')}
                checked={settings.minimizeOnLaunch}
                onChange={(minimizeOnLaunch) => void patchSettings({ minimizeOnLaunch })}
              />
              <Divider />
              <Switch
                label={t('settings.closeAfterLaunch')}
                hint={t('settings.closeAfterLaunchNote')}
                checked={settings.closeAfterLaunch}
                onChange={(closeAfterLaunch) => void patchSettings({ closeAfterLaunch })}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            id={anchor('library')}
            title={t('settings.section.library')}
            description={t('settings.sectionHint.library')}
          >
            <div className="space-y-1">
              <Switch
                label={t('settings.confirmBeforeRemoving')}
                checked={settings.confirmBeforeRemoving}
                onChange={(confirmBeforeRemoving) => void patchSettings({ confirmBeforeRemoving })}
              />
              <Divider />
              <Switch
                label={t('settings.scanOnFirstRun')}
                checked={settings.scanOnFirstRun}
                onChange={(scanOnFirstRun) => void patchSettings({ scanOnFirstRun })}
              />
            </div>
          </SettingsSection>

          {contributedSections.map(({ id, titleKey, descriptionKey, Section }) => (
            <SettingsSection
              key={id}
              id={anchor(id)}
              title={t(titleKey)}
              description={descriptionKey ? t(descriptionKey) : undefined}
              data-testid={`settings-section-${id}`}
            >
              <Section />
            </SettingsSection>
          ))}

          <SettingsSection
            id={anchor('unlock')}
            title={t('settings.section.unlock')}
            description={t('settings.sectionHint.unlock')}
            data-testid="settings-unlock"
          >
            <UnlockCodePanel />
          </SettingsSection>

          <SettingsSection
            id={anchor('about')}
            title={t('settings.section.about')}
            description={t('settings.sectionHint.about')}
            data-testid="settings-about"
          >
            <AboutPanel />
          </SettingsSection>

          {appInfo?.isDev && (
            <SettingsSection id={anchor('development')} title={t('settings.devTools')}>
              <DevToolsPanel />
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  )
}
