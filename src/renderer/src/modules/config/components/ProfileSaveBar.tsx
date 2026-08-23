import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, PencilLine, Save } from 'lucide-react'
import type { ConfigProfile, SaveProfileConflict } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/primitives'
import { useLauncher } from '../../../store/useLauncher'
import { ConfigConflictDialog } from '../ConfigConflictDialog'
import { saveConfigProfile } from '../client'
import { isProfileDirty, resolveSaveOutcome } from '../lib/save-bar'

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
 */
export function ProfileSaveBar({
  profile,
  onSaved,
}: {
  profile: ConfigProfile
  onSaved: (profile: ConfigProfile) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<SaveProfileConflict | null>(null)

  const dirty = isProfileDirty(profile)

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

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-sm border border-line bg-panel px-3 py-2">
        <div className="flex items-center gap-2">
          {dirty ? (
            <>
              <Badge tone="warning" className="gap-1">
                <PencilLine className="size-3" />
                {t('config.save.unsaved')}
              </Badge>
              <span className="text-xs text-ink-muted">{t('config.save.unsavedHint')}</span>
            </>
          ) : (
            <Badge tone="success" className="gap-1">
              <CircleCheck className="size-3" />
              {t('config.save.saved')}
            </Badge>
          )}
        </div>
        <Button
          data-testid="config-save"
          variant="primary"
          size="sm"
          icon={<Save className="size-3.5" />}
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? t('config.save.saving') : t('config.save.action')}
        </Button>
      </div>

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
