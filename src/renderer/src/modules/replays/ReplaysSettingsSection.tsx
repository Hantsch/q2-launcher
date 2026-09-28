import { NameTemplatesList } from './NameTemplatesList'

/**
 * Story 135 D3: the replays module's Settings section - inner content only, the shell
 * (`SettingsView.tsx`) already wraps every contributed section in its own `Panel` + `SectionLabel`
 * chrome, same as `servers/ServersSettingsSection.tsx`.
 *
 * Story 140 D3 replaces the placeholder paragraph with the naming-pattern list a user actually
 * edits (`NameTemplatesList`) - the module's first real control, mirroring story 111 D4's own
 * replacement of `servers-settings-placeholder`.
 */
export function ReplaysSettingsSection() {
  return <NameTemplatesList />
}
