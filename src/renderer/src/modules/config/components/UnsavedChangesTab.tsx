import { useTranslation } from 'react-i18next'
import { CircleCheck } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { EmptyState } from '../../../components/ui/primitives'
import { useUnsavedState } from '../lib/unsaved-state'
import { ProfileChangeList } from './ProfileChangeList'

/**
 * The before/after view of everything a Save would write (story 049 D5), now a tab of its own
 * rather than a disclosure inside the save-bar row - the list is long, the row was not, and the tab
 * strip already ranks it next to Care: last on the right, with a count badge (`UnsavedTabBadge`).
 *
 * The tab only exists while something is unsaved (`ConfigView` appends it conditionally and switches
 * away when the last change is saved or discarded), so the empty state below is the race case only -
 * a save landing while this tab is on screen, one render before that switch.
 *
 * A raw text draft is named, not listed: there is exactly one change, it is a whole file's text, and
 * it has no before/after row to show (story 057 D5's own reasoning, unchanged). It renders outside
 * `StructuredTabsGuard` in `ConfigView` for that reason too - it is the one tab that has something
 * to say *about* the draft, so it must not be the `inert` content the guard hides behind a hint.
 *
 * The "nothing to discard back to" sentence (story 049 D6) lives here rather than next to the header's
 * Discard button: the header row has no room for a sentence, and a `title` on a disabled button is
 * unreachable by keyboard - so the button renders disabled and this tab, the one surface that is
 * about the pending changes, states the reason as real text.
 */
export function UnsavedChangesTab({ profile }: { profile: ConfigProfile }) {
  const { t } = useTranslation()
  const { dirty, rawEdited, changeSet } = useUnsavedState(profile)

  if (!dirty && !rawEdited) {
    return (
      <EmptyState
        icon={<CircleCheck className="size-6" />}
        title={t('config.save.saved')}
        body={t('config.save.upToDate')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted" data-testid="config-save-summary">
        {rawEdited ? t('config.save.rawEdited') : t('config.save.unsavedHint')}
      </p>
      {dirty && (
        <>
          {profile.baseline === undefined && (
            <p className="text-xs text-ink-muted">{t('config.save.discardNoBaseline')}</p>
          )}
          <ProfileChangeList changeSet={changeSet} />
        </>
      )}
    </div>
  )
}
