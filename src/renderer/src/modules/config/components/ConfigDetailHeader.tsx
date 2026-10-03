import { useTranslation } from 'react-i18next'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { formatRelativeTime } from '../../../lib/format'
import { Button, IconButton } from '../../../components/ui/Button'
import { KeyValue } from '../../../components/ui/primitives'
import { AssignmentsMenu } from '../AssignmentsMenu'
import { useProfileDraftContext } from '../lib/ProfileDraftProvider'
import { useRawDraft } from '../lib/raw-draft'
import { ProfileSaveActions } from './ProfileSaveActions'
import { UnsavedIndicator } from './UnsavedIndicator'

/**
 * The header's Rename ends in a `markUnsaved`-shaped update, so it must be locked while the Raw tab
 * holds a draft, like the tab content under `StructuredTabsGuard`. Its own component because
 * `useRawDraft` has to be called below the `RawDraftProvider`. The reason is a `title` tooltip on
 * the icon button rather than a paragraph squeezed into the header row.
 */
function RenameHeaderButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const rawDraft = useRawDraft()
  return (
    <IconButton
      label={t('common.action.renameEllipsis')}
      size="sm"
      disabled={rawDraft.active}
      title={
        rawDraft.active ? t('config.raw.tabsLockedByDraft') : t('common.action.renameEllipsis')
      }
      onClick={onClick}
    >
      <Pencil className="size-3.5" />
    </IconButton>
  )
}

/**
 * ONE header row, identical on all seven tabs - back left, the profile's identity centred, the
 * action cluster right - and no second identity block below it (story 218).
 *
 * Three flex zones, not `grid-cols-[1fr_auto_1fr]`: the middle zone grows and wraps, where a rigid
 * three-column grid clips or overflows at the app's minimum 940px width. `gap-y-1` is what a wrapped
 * line costs; `justify-between` keeps back and actions on the outer edges once the middle wraps.
 */
export function ConfigDetailHeader({
  onBack,
  onRename,
  onDelete,
}: {
  onBack: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const { profile } = useProfileDraftContext()

  return (
    <header
      data-testid="config-profile-header"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
    >
      {/* `Button` is already `shrink-0`, so the left zone needs no wrapper of its own. */}
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={onBack}>
        {t('config.nav.back')}
      </Button>

      {/*
        The identity zone: exactly ONE `config-profile-identity` element (a guard asserts it), two
        child rows - line 1 is what a reader looks at first (which profile, whether it is saved),
        line 2 the created/updated context. `min-w-0` + `truncate` on the name keeps a long name
        from pushing the action cluster off the row.

        No `gap-y` between the rows, no `leading-*`, `items-center` on the header: the zone is
        20px + 16px = 36px and that is the whole remaining line budget over the 30-visible-editor-
        line floor (`scripts/flows/config-header-geometry.mjs`). Line 1 is pinned to the name's 20px
        (`h-5`): the unsaved `Badge` is 21px and would otherwise grow the header by 1px.
      */}
      <div
        data-testid="config-profile-identity"
        className="flex min-w-0 flex-1 flex-col items-center justify-center"
      >
        <div className="flex h-5 min-w-0 items-center gap-2">
          <h2 className="min-w-0 truncate font-display text-sm tracking-[0.06em] text-ink uppercase">
            {profile.name}
          </h2>
          <UnsavedIndicator profile={profile} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3">
          <KeyValue label={t('config.detail.created')}>
            {formatRelativeTime(profile.createdAt) ?? '-'}
          </KeyValue>
          <KeyValue label={t('config.detail.updated')}>
            {formatRelativeTime(profile.updatedAt) ?? '-'}
          </KeyValue>
        </div>
      </div>

      {/* `config-profile-actions`: the geometry flow compares this cluster's rect tab by tab. */}
      <div data-testid="config-profile-actions" className="flex shrink-0 items-center gap-2">
        {/* Save/Discard come and go, so they sit first and keep the always-present controls at a
            stable position on the right edge. */}
        <ProfileSaveActions />
        <AssignmentsMenu />
        <div className="flex items-center gap-1">
          <RenameHeaderButton onClick={onRename} />
          <IconButton
            label={t('common.action.deleteEllipsis')}
            size="sm"
            variant="danger"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </header>
  )
}
