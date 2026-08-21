import { useTranslation } from 'react-i18next'
import { ExternalLink, FlaskConical, FolderOpen } from 'lucide-react'
import { APP_REPO_URL } from '@shared/constants'
import type { LocaleSetting, MotionSetting } from '@shared/types'
import { invoke } from '../lib/bridge'
import { useLauncher } from '../store/useLauncher'
import { SUPPORTED_LOCALES } from '../i18n'
import { Button } from '../components/ui/Button'
import { Select, Switch } from '../components/ui/controls'
import { Divider, KeyValue, Panel, SectionLabel } from '../components/ui/primitives'

const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
}

export function SettingsView() {
  const { t } = useTranslation()
  const settings = useLauncher((state) => state.settings)
  const patchSettings = useLauncher((state) => state.patchSettings)
  const appInfo = useLauncher((state) => state.appInfo)

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

        <Panel className="space-y-2.5 p-4">
          <SectionLabel>{t('settings.section.about')}</SectionLabel>

          <KeyValue label={t('settings.version')} mono>
            {appInfo?.appVersion ?? '-'}
          </KeyValue>
          <KeyValue label={t('settings.electron')} mono>
            {appInfo?.electronVersion ?? '-'}
          </KeyValue>
          <KeyValue label={t('settings.chrome')} mono>
            {appInfo?.chromeVersion ?? '-'}
          </KeyValue>
          <KeyValue label={t('settings.node')} mono>
            {appInfo?.nodeVersion ?? '-'}
          </KeyValue>

          <Divider className="my-1" />

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SectionLabel>{t('settings.userData')}</SectionLabel>
              <p
                className="numeric truncate text-[11px] text-ink-muted"
                title={appInfo?.userDataPath}
                data-selectable
              >
                {appInfo?.userDataPath ?? '-'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<FolderOpen className="size-3.5" />}
              disabled={!appInfo}
              onClick={() => {
                if (appInfo) void invoke('app:revealPath', appInfo.userDataPath)
              }}
            >
              {t('settings.openFolder')}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <SectionLabel>{t('settings.logs')}</SectionLabel>
              <p
                className="numeric truncate text-[11px] text-ink-muted"
                title={appInfo?.logPath}
                data-selectable
              >
                {appInfo?.logPath ?? '-'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<FolderOpen className="size-3.5" />}
              disabled={!appInfo}
              onClick={() => {
                if (appInfo) void invoke('app:revealPath', appInfo.logPath)
              }}
            >
              {t('settings.openFolder')}
            </Button>
          </div>

          <Divider className="my-1" />

          <Button
            variant="link"
            size="sm"
            icon={<ExternalLink className="size-3.5" />}
            onClick={() => void invoke('app:openExternal', APP_REPO_URL)}
          >
            {t('settings.repository')}
          </Button>
        </Panel>

        {appInfo?.isDev && (
          <Panel className="space-y-3 p-4">
            <SectionLabel>{t('settings.devTools')}</SectionLabel>
            <p className="text-xs leading-relaxed text-ink-muted">
              Development builds only. Emits a fake download job so the action bar&rsquo;s progress
              readout can be worked on before the install module exists.
            </p>
            <Button
              variant="neutral"
              size="sm"
              icon={<FlaskConical className="size-3.5" />}
              onClick={() => void invoke('dev:simulateJob')}
            >
              {t('settings.simulateJob')}
            </Button>
          </Panel>
        )}
      </div>
    </div>
  )
}
