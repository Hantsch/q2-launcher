import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, CircleCheck, PencilLine, Save, Undo2 } from 'lucide-react'
import type { ConfigProfile, SaveProfileConflict } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/primitives'
import { useLauncher } from '../../../store/useLauncher'
import { ConfigConflictDialog } from '../ConfigConflictDialog'
import { DiscardChangesDialog } from '../DiscardChangesDialog'
import { saveConfigProfile } from '../client'
import { useProfileChanges } from '../lib/profile-changes'
import { useRawDraft } from '../lib/raw-draft'
import { isProfileDirty, resolveSaveOutcome } from '../lib/save-bar'
import { ProfileChangeList } from './ProfileChangeList'

/**
 * Story 043 D6: the unsaved-changes indicator + explicit Save button that replaces the deleted
 * `useProfileAutoWrite` write-on-every-change. Mounted once by `ConfigView`'s detail screen, at the
 * same "detail level, not inside one tab" placement the auto-write hook used, so Save works no
 * matter which of Overview/Settings/Controls/Raw File is showing.
 *
 * Reads `profile.dirty` straight off the server profile passed in (`isProfileDirty`,
 * `lib/save-bar.ts`) - never a second, renderer-local "is this dirty" tracker - so the indicator can
 * never disagree with what main actually persisted (022 decision 8's inversion, story 043). `dirty`
 * is not one of `useProfileDraft`'s `LOCALLY_PATCHED_FIELDS`, so `selected` and `draftOrSelected`
 * carry the identical value at any given render; `ConfigView` passes `selected` here, the least
 * indirection of the two.
 *
 * Icon + text pairing for the status, never colour alone, same idiom as `CareSyncSection`'s
 * `SyncRow`. The Save button stays visible but disabled (rather than hidden) when there is nothing
 * to save - a stable layout beats a control that pops in and out as edits land.
 *
 * Story 043 D8: a `'conflict'` outcome now opens `ConfigConflictDialog` (mounted right here, since
 * this component already has `profile.id` and the exact `onSaved` callback the dialog's own
 * `onResolved` needs to reuse) instead of the D6 toast stub - see `resolveSaveOutcome`'s own doc
 * comment for why that action type exists.
 *
 * Story 049 D5: a disclosure next to the badge expands into `ProfileChangeList`, the before/after
 * view of everything a Save would write. It reads `useProfileChanges()` - the same context-shared
 * change set every row and the bar itself consume (story 049, Decisions) - rather than computing or
 * receiving its own copy, so the count on the button and the rows it expands into can never
 * disagree with each other or with a cvar row's indicator (D7/D8). The disclosure only appears
 * while `dirty` is true: once saved there is no pending count left to show, and gating on `dirty`
 * rather than a second "changeSet is non-empty" check keeps this bar with exactly one notion of
 * "there is something to show" (the story's own wording for this). Expanding/collapsing is local,
 * transient UI state that does not touch `saving`/`conflict` or the Save button's own
 * `disabled`/`onClick` - the story requires Save to stay fully usable while expanded.
 *
 * Story 049 D6: a Discard button sits next to Save, shown only while `dirty` is true (nothing to
 * discard otherwise, same disclosure-only-when-dirty precedent D5 set). It is enabled only when
 * `profile.baseline` is set; when there is no baseline it renders disabled with a visible sentence
 * next to it explaining why - not a `title` tooltip, since a disabled button is not keyboard
 * focusable and a tooltip would be unreachable (the story's own Decisions). `DiscardChangesDialog`
 * is owned and opened right here, the same way `ConfigConflictDialog` already is - the closer
 * precedent, since both are confirm/resolve dialogs this bar itself triggers rather than ones
 * `ConfigView` opens over the whole detail screen (compare `DeleteProfileDialog`, which the header's
 * delete button owns at that level instead).
 *
 * Story 057 D5: a raw-text draft (`useRawDraft`, `lib/raw-draft.tsx`) is the *second* thing this bar
 * can report as unsaved, and the two are mutually exclusive by construction (see that file). While a
 * draft is active the bar names that one change inline ("file text edited") rather than expanding a
 * `ProfileChangeList` - there is exactly one change, it is a whole file's text, and it has no
 * before/after row to show - and both actions route to the draft: Save writes the typed text through
 * `config:saveRawText`, Discard drops it. A raw Discard opens no confirmation dialog and carries no
 * ellipsis in its label: nothing is written and nothing on disk changes, and the story's own test
 * plan (step 6) expects the edit to be gone on the click itself.
 */
export function ProfileSaveBar({
  profile,
  onSaved,
  onDiscarded,
}: {
  profile: ConfigProfile
  onSaved: (profile: ConfigProfile) => void
  /** The full, updated profile list, per the config module's discard contract. */
  onDiscarded: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<SaveProfileConflict | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const changeSet = useProfileChanges()
  const rawDraft = useRawDraft()

  // A raw draft takes precedence over the structured diff wherever the two could both be true at
  // once (`lib/raw-draft.tsx` explains why): the typed text is the only thing here that exists
  // nowhere else, so it is what Save and Discard must act on.
  const rawEdited = rawDraft.active
  const dirty = isProfileDirty(profile) && !rawEdited
  const unsaved = dirty || rawEdited

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    const outcome = await saveConfigProfile({ profileId: profile.id })
    setSaving(false)

    const action = resolveSaveOutcome(outcome)
    if (action.type === 'saved') {
      onSaved(action.profile)
      return
    }

    if (action.type === 'conflict') {
      setConflict(action.conflict)
      return
    }

    // `action.type === 'toast'`: covers the transport-level error and the unreadable-file cases -
    // neither calls `onSaved`, so `dirty` is left exactly as it was and nothing the user typed is
    // lost.
    pushToast({
      level: 'error',
      messageKey: action.messageKey,
      timeoutMs: 0,
      ...(action.params ? { params: action.params } : {}),
    })
  }

  const canDiscard = dirty && profile.baseline !== undefined

  return (
    <>
      <div className="rounded-sm border border-line bg-panel">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {unsaved ? (
              <>
                <Badge tone="warning" className="gap-1">
                  <PencilLine className="size-3" />
                  {t('config.save.unsaved')}
                </Badge>
                <span className="text-xs text-ink-muted" data-testid="config-save-summary">
                  {rawEdited ? t('config.save.rawEdited') : t('config.save.unsavedHint')}
                </span>
                {dirty && changeSet.count > 0 && (
                  <Button
                    data-testid="config-save-toggle"
                    variant="ghost"
                    size="sm"
                    trailingIcon={
                      expanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )
                    }
                    aria-expanded={expanded}
                    aria-controls="config-save-changes-panel"
                    onClick={() => setExpanded((current) => !current)}
                  >
                    {t('config.save.toggle', { count: changeSet.count })}
                  </Button>
                )}
              </>
            ) : (
              <Badge tone="success" className="gap-1">
                <CircleCheck className="size-3" />
                {t('config.save.saved')}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {rawEdited ? (
              <Button
                data-testid="config-discard"
                variant="ghost"
                size="sm"
                icon={<Undo2 className="size-3.5" />}
                disabled={rawDraft.saving}
                onClick={() => rawDraft.discard()}
              >
                {t('config.save.discardRaw')}
              </Button>
            ) : (
              dirty && (
                <>
                  {!canDiscard && (
                    <span className="text-xs text-ink-muted">
                      {t('config.save.discardNoBaseline')}
                    </span>
                  )}
                  <Button
                    data-testid="config-discard"
                    variant="ghost"
                    size="sm"
                    icon={<Undo2 className="size-3.5" />}
                    disabled={!canDiscard}
                    onClick={() => setShowDiscard(true)}
                  >
                    {t('config.save.discard')}
                  </Button>
                </>
              )
            )}
            <Button
              data-testid="config-save"
              variant="primary"
              size="sm"
              icon={<Save className="size-3.5" />}
              disabled={!unsaved || saving || rawDraft.saving}
              onClick={() => (rawEdited ? rawDraft.save() : void handleSave())}
            >
              {saving || rawDraft.saving ? t('config.save.saving') : t('config.save.action')}
            </Button>
          </div>
        </div>

        {dirty && expanded && (
          <div
            id="config-save-changes-panel"
            data-testid="config-save-changes-panel"
            className="border-t border-line px-3 py-2"
          >
            <ProfileChangeList changeSet={changeSet} />
          </div>
        )}
      </div>

      {showDiscard && (
        <DiscardChangesDialog
          profile={profile}
          onClose={() => setShowDiscard(false)}
          onDiscarded={(profiles) => {
            setShowDiscard(false)
            onDiscarded(profiles)
          }}
        />
      )}

      {conflict && (
        <ConfigConflictDialog
          profileId={profile.id}
          conflict={conflict}
          onClose={() => setConflict(null)}
          onResolved={(resolved) => {
            setConflict(null)
            onSaved(resolved)
          }}
        />
      )}
    </>
  )
}
