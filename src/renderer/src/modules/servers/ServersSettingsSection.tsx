import { useTranslation } from 'react-i18next'

/**
 * Story 106 D3: the servers module's Settings section - inner content only, the shell
 * (`SettingsView.tsx`) already wraps every contributed section in its own `Panel` +
 * `SectionLabel` chrome, same as `downloads/DownloadsSettingsSection.tsx`.
 *
 * The servers module has no controls yet (its handler/scanning logic lands in later
 * deliverables of this story) - this section is placeholder text only, proving AC5's "Settings
 * shows a servers section" without pretending there is anything to configure.
 */
export function ServersSettingsSection() {
  const { t } = useTranslation()

  return (
    <p className="text-sm text-ink-dim" data-testid="servers-settings-placeholder">
      {t('module.servers.settings.placeholder')}
    </p>
  )
}
