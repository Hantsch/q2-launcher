import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'
import type { LocaleSetting, MotionSetting } from '@shared/types'
import { invoke } from '../lib/bridge'
import { useLauncher } from '../store/useLauncher'
import { SUPPORTED_LOCALES } from '../i18n'
import { AboutPanel } from '../components/about/AboutPanel'
import { UnlockCodePanel } from '../components/unlock/UnlockCodePanel'
import { Button } from '../components/ui/Button'
import { Select, Switch } from '../components/ui/controls'
import { Divider, Panel, SectionLabel } from '../components/ui/primitives'
import { RENDERER_MODULES, type RendererModule } from '../modules'

const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
}

/**
 * Module-contributed sections, sorted by `order` then module id so a tie is
 * deterministic instead of depending on registration order in `modules/index.ts`.
 */
function settingsSections(
  modules: readonly RendererModule[],
): Array<{ id: string; titleKey: string; order: number; Section: ComponentType }> {
  return modules
    .filter((module) => module.settingsSection !== undefined)
    .map((module) => ({
      id: module.id,
      titleKey: module.settingsSection!.titleKey,
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

  return (
    <div className="h-full overflow-y-auto scrollbar-gutter-stable">
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
          {t('settings.title')}
        </h1>

        <Panel className="space-y-4 p-4">
          <SectionLabel>{t('settings.section.appearance')}</SectionLabel>

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
        </Panel>

        <Panel className="space-y-1 p-4">
          <SectionLabel>{t('settings.section.launch')}</SectionLabel>
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
        </Panel>

        <Panel className="space-y-1 p-4">
          <SectionLabel>{t('settings.section.library')}</SectionLabel>
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
        </Panel>

        {contributedSections.map(({ id, titleKey, Section }) => (
          <Panel key={id} className="space-y-2.5 p-4" data-testid={`settings-section-${id}`}>
            <SectionLabel>{t(titleKey)}</SectionLabel>
            <Section />
          </Panel>
        ))}

        <Panel className="space-y-2.5 p-4" data-testid="settings-unlock">
          <SectionLabel>{t('settings.section.unlock')}</SectionLabel>
          <UnlockCodePanel />
        </Panel>

        <Panel className="space-y-2.5 p-4" data-testid="settings-about">
          <SectionLabel>{t('settings.section.about')}</SectionLabel>
          <AboutPanel />
        </Panel>

        {appInfo?.isDev && (
          <Panel className="space-y-3 p-4">
            <SectionLabel>{t('settings.devTools')}</SectionLabel>
            <p className="text-xs leading-relaxed text-ink-muted">
              Development builds only. Emits a fake download job so the action bar&rsquo;s progress
              readout and the Downloads tab can be worked on before the downloads module exists.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() => void invoke('dev:simulateJob', { scenario: 'success' })}
              >
                {t('settings.simulateJob')}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() => void invoke('dev:simulateJob', { scenario: 'stall' })}
              >
                {t('settings.simulateJobStall')}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() => void invoke('dev:simulateJob', { scenario: 'failure' })}
              >
                {t('settings.simulateJobFailure')}
              </Button>
            </div>

            <p className="text-xs leading-relaxed text-ink-muted">
              Story 098 D4. Drives the update control through every phase without a real check or
              download.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() =>
                  void invoke('dev:simulateAppUpdate', {
                    scenario: 'available',
                    version: '9.9.9-dev',
                    notes: 'Simulated release notes for dev testing.',
                  })
                }
              >
                {t('settings.simulateUpdateAvailable')}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() =>
                  void invoke('dev:simulateAppUpdate', { scenario: 'progress', ratio: 0.5 })
                }
              >
                {t('settings.simulateUpdateProgress')}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() => void invoke('dev:simulateAppUpdate', { scenario: 'downloaded' })}
              >
                {t('settings.simulateUpdateDownloaded')}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() =>
                  void invoke('dev:simulateAppUpdate', { scenario: 'error', reason: 'offline' })
                }
              >
                {t('settings.simulateUpdateError')}
              </Button>
              <Button
                variant="neutral"
                size="sm"
                icon={<FlaskConical className="size-3.5" />}
                onClick={() => void invoke('dev:simulateAppUpdate', { scenario: 'upToDate' })}
              >
                {t('settings.simulateUpdateUpToDate')}
              </Button>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
