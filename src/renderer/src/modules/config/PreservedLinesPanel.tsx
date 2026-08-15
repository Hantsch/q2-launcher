import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { SectionLabel } from '../../components/ui/primitives'

/**
 * Read-only display of `profile.unrecognized` (story 005, decision 9):
 * anything the importer could not classify stays visible on the profile
 * itself, not just in the import dialog's preview, so AC 4 ("shown to me,
 * not silently dropped") survives past the moment the dialog closes.
 *
 * Renders for every profile, imported or not - a profile with nothing
 * preserved is the good/normal case for anything created empty, from the
 * template, or from scratch, so it gets a small inline empty message
 * (mirroring `ProfileAssignmentsPanel`'s `noInstallations` treatment) rather
 * than the page-level `EmptyState` reserved for "no profiles at all".
 *
 * Text is rendered verbatim: no truncation, no reformatting. Long lines wrap
 * and the block scrolls horizontally if needed instead of hiding content,
 * since the entire point of this panel is that nothing gets silently lost.
 */
export function PreservedLinesPanel({ profile }: { profile: ConfigProfile }) {
  const { t } = useTranslation()
  const lines = profile.unrecognized ?? []

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.preservedLines.label')}</SectionLabel>

      {lines.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('config.preservedLines.empty.body')}</p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((line, index) => (
            <li
              key={`${line.file}:${line.line}:${index}`}
              className="space-y-1 rounded-sm border border-line px-2.5 py-2"
            >
              <span className="numeric block text-xs text-ink-muted">
                {line.file}:{line.line}
              </span>
              <code className="block overflow-x-auto text-xs whitespace-pre text-ink-dim">
                {line.text}
              </code>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
