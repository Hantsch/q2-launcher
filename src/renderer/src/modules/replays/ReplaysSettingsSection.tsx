import { useTranslation } from 'react-i18next'

/**
 * Story 135 D3: the replays module's Settings section - inner content only, the shell
 * (`SettingsView.tsx`) already wraps every contributed section in its own `Panel` + `SectionLabel`
 * chrome, same as `servers/ServersSettingsSection.tsx`.
 *
 * The module has no view and no service yet (`RENDERER_MODULES`'s `replays` entry carries no
 * `View`), so this is a placeholder-only paragraph - mirrors story 106 D3's original
 * `servers-settings-placeholder`, replaced there once the module grew real controls. This one will
 * be replaced the same way once a later deliverable of this story (or a follow-up) adds real
 * demo-folder settings.
 */
export function ReplaysSettingsSection() {
  const { t } = useTranslation()

  return (
    <p className="text-sm text-ink-muted" data-testid="replays-settings-placeholder">
      {t('replays.settings.placeholder')}
    </p>
  )
}
