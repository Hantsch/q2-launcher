import { useTranslation } from 'react-i18next'
import type {
  ProfileChange,
  ProfileChangeDetail,
  ProfileChangeSection,
  ProfileChangeSet,
} from '@shared/config/profile-diff'
import { Badge, type BadgeTone, SectionLabel } from '../../../components/ui/primitives'

/**
 * Story 049 D5: the before/after list of what a Save would write, rendered by `UnsavedChangesTab`
 * (originally a disclosure inside the save-bar row) - a structured list of
 * `changeSet`'s per-section buckets (story Decisions: a structured list, not a text diff of the
 * rendered file), grouped the same way `ProfileChangeSet.sections` already groups them.
 *
 * A section with no pending change is not rendered at all - `sections` already omits empty
 * buckets (see `profile-diff.ts`'s `buildChangeSet`), so this component only has to iterate what
 * is present, never filter anything itself.
 *
 * Mirrors `ConfigConflictDialog`'s two-column before/after *framing* in spirit, but as structured
 * rows rather than `ConfigCodeView` panes - each change already carries its own legible
 * before/after strings (`profile-diff.ts`), so there is no file text to diff here, only prose to
 * wrap around numbers that already make sense.
 *
 * Story 064 D2: a row now reads as an actual diff rather than a one-line summary a user has to
 * compare by eye. Three additions over story 049's shape, all renderer-side (main sends no prose,
 * per CLAUDE.md):
 * - a text `kind` `Badge` (added/removed/changed) next to the existing "unset"/"unbound"
 *   placeholder for the missing side - AC2's non-colour-alone marker, mirroring story 049's own
 *   row glyph rule.
 * - when `change.details` is populated (D1, `actions`/`layers` `changed` rows only), a nested
 *   `field: before -> after` list under the summary line, each value in a bounded, scrollable
 *   block (`max-h-24 overflow-y-auto whitespace-pre-line break-words`, mirroring
 *   `CareBatchFixDialog.tsx`'s before/after pair) rather than `line-clamp` + `title`, which would
 *   hide the very command that changed and be unreachable by keyboard (AC5).
 * - `settings` rows resolve their field key (`name`/`writeUnbindall`/`sectionHeaderStyle`) through
 *   an i18n label map instead of printing it verbatim; the values stay the literal strings a save
 *   writes.
 */

const SECTION_ORDER: readonly ProfileChangeSection[] = [
  'cvars',
  'binds',
  'actions',
  'layers',
  'settings',
  'unrecognized',
]

const SECTION_LABEL_KEYS: Record<ProfileChangeSection, string> = {
  cvars: 'config.save.changes.section.cvars',
  binds: 'config.save.changes.section.binds',
  actions: 'config.save.changes.section.actions',
  layers: 'config.save.changes.section.layers',
  settings: 'config.save.changes.section.settings',
  unrecognized: 'config.save.changes.section.unrecognized',
}

export function ProfileChangeList({ changeSet }: { changeSet: ProfileChangeSet }) {
  const { t } = useTranslation()
  const sections = SECTION_ORDER.filter((section) => (changeSet.sections[section]?.length ?? 0) > 0)

  if (sections.length === 0) return null

  return (
    <div className="space-y-3" data-testid="config-save-changes">
      {sections.map((section) => (
        <div key={section} className="space-y-1">
          <SectionLabel>{t(SECTION_LABEL_KEYS[section])}</SectionLabel>
          <ul className="space-y-1">
            {changeSet.sections[section]!.map((change) => (
              <ChangeRow key={`${section}:${change.key}`} section={section} change={change} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** Which field of a `settings` row (`diffSettings`'s `key`) resolves to which i18n label - the
 * renderer-side translation `profile-diff.ts:468`'s doc comment asks for; the values themselves
 * stay the literal strings a save writes (story 064, Decisions). */
const SETTINGS_LABEL_KEYS: Record<string, string> = {
  name: 'config.save.changes.settingsLabel.name',
  writeUnbindall: 'config.save.changes.settingsLabel.writeUnbindall',
  sectionHeaderStyle: 'config.save.changes.settingsLabel.sectionHeaderStyle',
}

/** Badge tone per kind - text is the actual AC2 marker (below), the tone is a secondary,
 * non-load-bearing cue. */
const KIND_TONE: Record<ProfileChange['kind'], BadgeTone> = {
  added: 'success',
  removed: 'danger',
  changed: 'neutral',
}

function ChangeRow({ section, change }: { section: ProfileChangeSection; change: ProfileChange }) {
  const { t } = useTranslation()
  // The missing side of an added/removed change is `undefined` (`profile-diff.ts`'s own doc
  // comment: showing something for it is this layer's decision). "unbound" for binds matches the
  // story's own example ("`F1` unbound -> `say gg`"); every other section gets the generic "unset".
  const emptyLabel = t(
    section === 'binds' ? 'config.save.changes.unbound' : 'config.save.changes.unset',
  )
  const before = change.before ?? emptyLabel
  const after = change.after ?? emptyLabel
  const label =
    section === 'settings'
      ? t(SETTINGS_LABEL_KEYS[change.key] ?? change.label, change.label)
      : change.label

  return (
    <li className="space-y-1 rounded-sm border border-line px-2 py-1 text-xs">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-medium text-ink" data-selectable>
          {label}
        </span>
        <Badge tone={KIND_TONE[change.kind]}>{t(`config.save.changes.kind.${change.kind}`)}</Badge>
        <span className="sr-only">{t('config.save.changes.before')}</span>
        <span className="numeric min-w-0 break-words text-ink-dim" data-selectable>
          {before}
        </span>
        <span aria-hidden="true" className="text-ink-muted">
          →
        </span>
        <span className="sr-only">{t('config.save.changes.after')}</span>
        <span className="numeric min-w-0 break-words text-ink-dim" data-selectable>
          {after}
        </span>
      </div>
      {change.details && change.details.length > 0 && (
        <ul className="space-y-1 border-t border-line pl-3 pt-1">
          {change.details.map((detail) => (
            <DetailRow key={detail.field} detail={detail} />
          ))}
        </ul>
      )}
    </li>
  )
}

function DetailRow({ detail }: { detail: ProfileChangeDetail }) {
  const { t } = useTranslation()
  const emptyLabel = t('config.save.changes.unset')

  return (
    <li className="min-w-0 space-y-0.5">
      <span className="font-medium text-ink-dim" data-selectable>
        {t(`config.save.changes.field.${detail.field}`, detail.field)}
      </span>
      <div className="flex min-w-0 flex-wrap items-start gap-x-1.5 gap-y-0.5">
        <span className="sr-only">{t('config.save.changes.before')}</span>
        <div
          className="numeric min-w-0 max-h-24 flex-1 overflow-y-auto whitespace-pre-line break-words text-ink-dim"
          data-selectable
          data-testid="profile-change-detail-value"
        >
          {detail.before ?? emptyLabel}
        </div>
        <span aria-hidden="true" className="shrink-0 text-ink-muted">
          →
        </span>
        <span className="sr-only">{t('config.save.changes.after')}</span>
        <div
          className="numeric min-w-0 max-h-24 flex-1 overflow-y-auto whitespace-pre-line break-words text-ink-dim"
          data-selectable
          data-testid="profile-change-detail-value"
        >
          {detail.after ?? emptyLabel}
        </div>
      </div>
    </li>
  )
}
