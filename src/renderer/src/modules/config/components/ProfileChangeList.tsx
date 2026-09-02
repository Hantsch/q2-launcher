import { useTranslation } from 'react-i18next'
import type {
  ProfileChange,
  ProfileChangeSection,
  ProfileChangeSet,
} from '@shared/config/profile-diff'
import { SectionLabel } from '../../../components/ui/primitives'

/**
 * Story 049 D5: the before/after list a `ProfileSaveBar` expands into - a structured list of
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

  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-sm border border-line px-2 py-1 text-xs">
      <span className="font-medium text-ink" data-selectable>
        {change.label}
      </span>
      <span className="numeric text-ink-dim" data-selectable>
        {before}
      </span>
      <span aria-hidden="true" className="text-ink-muted">
        →
      </span>
      <span className="numeric text-ink-dim" data-selectable>
        {after}
      </span>
    </li>
  )
}
