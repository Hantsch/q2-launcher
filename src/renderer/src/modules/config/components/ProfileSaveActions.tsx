import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, Undo2 } from 'lucide-react'
import type { ConfigProfile, SaveProfileConflict } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { useLauncher } from '../../../store/useLauncher'
import { ConfigConflictDialog } from '../ConfigConflictDialog'
import { DiscardChangesDialog } from '../DiscardChangesDialog'
import { saveConfigProfile } from '../client'
import { useRawDraft } from '../lib/raw-draft'
import { resolveSaveOutcome } from '../lib/save-bar'
import { useUnsavedState } from '../lib/unsaved-state'

/**
 * The explicit Save + Discard pair (stories 043 D6 / 049 D6 / 057 D5), now living in the detail
 * header's right-hand control cluster instead of the dedicated save-bar row that used to sit above
 * the tabs - the row itself is gone, its status went to the indicator next to the profile name
 * (`UnsavedIndicator`) and its change list became the Unsaved tab (`UnsavedChangesTab`).
 *
 * Renders nothing at all while there is nothing to save. Story 043 D6 deliberately kept Save
 * visible-but-disabled ("a stable layout beats a control that pops in and out"), which held while
 * this pair owned a row of its own; in the header cluster the opposite is true - a permanently
 * disabled primary button next to Rename/Delete reads as part of the profile's chrome, and the
 * indicator plus the Unsaved tab now carry the "there is something pending" signal on their own.
 *
 * Everything below the surface is unchanged: `profile.dirty` (through `useUnsavedState`) is still the
 * only notion of structured dirtiness, a raw draft still wins over it and routes both actions to
 * `rawDraft`, `resolveSaveOutcome` still turns a save into exactly one outcome, and both dialogs are
 * still owned here (the same reason as before: this component triggers them, unlike
 * `DeleteProfileDialog`, which the header's delete button owns at `ConfigView` level).
 *
 * The "no baseline to discard back to" sentence (story 049 D6) is not repeated here - the header row
 * has no room for a sentence, and a `title` on a disabled button is unreachable by keyboard. Discard
 * renders disabled in that case and `UnsavedChangesTab` states the reason in readable text instead.
 */
export function ProfileSaveActions({
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
  const [showDiscard, setShowDiscard] = useState(false)
  const rawDraft = useRawDraft()
  const { dirty, rawEdited, unsaved } = useUnsavedState(profile)

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

  // Only the *buttons* are gated on `unsaved` - the two dialogs stay mounted across a state change
  // that ends it (a discard resolving, say), so a dialog reporting its own result is never yanked
  // off screen by the very change it caused.
  return (
    <>
      {unsaved && (
        <div className="flex items-center gap-1.5">
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
          )}
          <Button
            data-testid="config-save"
            variant="primary"
            size="sm"
            icon={<Save className="size-3.5" />}
            disabled={saving || rawDraft.saving}
            onClick={() => (rawEdited ? rawDraft.save() : void handleSave())}
          >
            {saving || rawDraft.saving ? t('config.save.saving') : t('config.save.action')}
          </Button>
        </div>
      )}

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
