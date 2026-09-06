import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderOpen } from 'lucide-react'
import type { ConfigProfile, RawFilesResult } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { IconButton } from '../../components/ui/Button'
import { Checkbox, Select } from '../../components/ui/controls'
import { HoverCard } from '../../components/ui/HoverCard'
import { Badge, Panel, Spinner } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import {
  getRawFiles,
  openProfileFile,
  updateProfileSectionHeaderStyle,
  updateProfileWriteUnbindall,
} from './client'
import { ConfigCodeView } from './components/ConfigCodeView'
import { useProfileChanges } from './lib/profile-changes'
import { rawEditingMode, useRawDraft } from './lib/raw-draft'
import { isProfileDirty } from './lib/save-bar'

/**
 * Raw File tab (story 023, compacted by story 057 D3): shows the profile's
 * own canonical file - even for a profile assigned nowhere (AC 3) - as one
 * path/status line, one file-options toolbar row, and the read-only code
 * view below. The per-installation cards this tab used to show (one per
 * assigned installation, each expandable into `RawConfigPanel`) moved out;
 * story 058 ("Care's Sync") remounts that view in a different feature.
 *
 * Module-local, props-based: owns its own fetch, no shell-store dependency
 * beyond `pushToast` for action failures.
 */
export function RawFileTab({
  profile,
  onChanged,
}: {
  profile: ConfigProfile
  onChanged: (profiles: ConfigProfile[]) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  // Story 049 D8: this tab shows the on-disk file, so the honest statement about pending edits is
  // a notice, not a per-row border (the story's own Decisions) - the same change set the save bar
  // and every other tab read (`useProfileChanges`, `lib/profile-changes.tsx`).
  const changeSet = useProfileChanges()
  // Story 057 D5: the renderer-local text draft this tab's editor writes into.
  const rawDraft = useRawDraft()
  // Story 057 D3 fix: the section-header-style label is a bare `<span>` beside a `HoverCard`
  // tooltip (not a `Field`), so it needs its own id/`aria-labelledby` pairing with the `<select>`
  // to keep an accessible name - `Field`'s `htmlFor` trick doesn't apply here.
  const sectionHeaderStyleLabelId = useId()

  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<Outcome<RawFilesResult> | null>(null)

  // Re-reads on a profile switch AND on a save (`updatedAt` bump) - AC 7:
  // "switching profiles or installations re-reads the file rather than
  // showing a stale copy".
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setResult(null)
    void getRawFiles({ profileId: profile.id }).then((outcome) => {
      if (cancelled) return
      setResult(outcome)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [profile.id, profile.updatedAt])

  const openFile = async (mode: 'open' | 'reveal'): Promise<void> => {
    const outcome = await openProfileFile({ profileId: profile.id, installationId: null, mode })
    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
    }
  }

  const toggleWriteUnbindall = async (checked: boolean): Promise<void> => {
    const outcome = await updateProfileWriteUnbindall({
      profileId: profile.id,
      writeUnbindall: checked,
    })
    if (outcome.ok) {
      onChanged(outcome.value)
    }
  }

  const changeSectionHeaderStyle = async (
    style: 'dashes' | 'brackets' | 'plain',
  ): Promise<void> => {
    const outcome = await updateProfileSectionHeaderStyle({
      profileId: profile.id,
      sectionHeaderStyle: style,
    })
    if (outcome.ok) {
      onChanged(outcome.value)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    )
  }

  if (result && !result.ok) {
    return <p className="text-sm text-danger">{t(result.error.key, result.error.params)}</p>
  }

  if (!result) return null

  const { canonical } = result.value

  /*
    Story 057 D5. Three things decide what the code view is:

    - `mode` (`rawEditingMode`, `lib/raw-draft.tsx`) - the same pure rule the draft context itself
      applies to `setText`, so the view and the guard can never disagree about whether typing is
      allowed. `'lockedByChanges'` renders the read-only view plus a one-line hint, which is how the
      "the editor is read-only while `profile.dirty`" half of AC7 is met without a second editing
      mode to keep in sync.
    - the seed text: the draft's own text when there is one, so a remount (see below) restores what
      the user typed rather than the file underneath it.
    - the `key`: `ConfigCodeView`'s editable mode seeds its textarea from `text` exactly once (its
      own doc comment), so it has to be remounted whenever the text it should show changes for a
      reason other than typing - a profile switch, a save/adopt (`updatedAt`) or a Discard
      (`resetToken`).
  */
  const mode = rawEditingMode({
    onDisk: canonical.onDisk,
    profileDirty: isProfileDirty(profile),
    draftActive: rawDraft.active,
  })
  const editorText = rawDraft.text ?? canonical.content
  const editorKey = `${profile.id}:${profile.updatedAt}:${rawDraft.resetToken}`

  /* Ctrl+S saves the draft through the exact same `rawDraft.save()` the save bar's own button
     calls - one save path, not two. Scoped to the editor's own container (never a `window`
     listener), the same idiom `ConfigCodeView` uses for its Ctrl+F: the keystroke only means
     "save the file text" while focus is actually inside the editor. */
  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      rawDraft.save()
    }
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-0.5">
      {/* Story 057 D3's separate "This profile's file" `SectionLabel` was dropped in the review fix
          for blocker 1 (AC1 - "at least 30 lines visible at 1280x800"): the tab strip already reads
          "Raw file" for the selected tab and the path row right below names the actual file, so the
          label carried no information neither of those two already gave - only height. */}

      {/* Story 057 D3: one path/status line - path, on-disk state, unsaved-change count (when
          any), open-in-editor, reveal-in-folder - merged with the file-options toolbar row
          (`unbindall` checkbox, section header style select) into this single row in the blocker-1
          review fix, the same "reduced padding" compaction the story's own plan already called for
          in this spot: two one-line rows cost a whole extra row of chrome that 30 visible code lines
          at 1280x800 cannot spare. Wraps at the narrower viewport instead of clipping. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <p
          className="numeric min-w-0 flex-1 truncate text-xs text-ink-dim"
          title={canonical.path}
          data-selectable
        >
          {canonical.path}
        </p>
        <Badge tone={canonical.onDisk ? 'success' : 'neutral'}>
          {canonical.onDisk ? t('config.raw.onDisk') : t('config.raw.notOnDisk')}
        </Badge>
        {changeSet.count > 0 && (
          <Badge tone="warning">{t('config.raw.unsavedNotice', { count: changeSet.count })}</Badge>
        )}
        <IconButton
          label={t('config.raw.openEditor')}
          size="sm"
          disabled={!canonical.onDisk}
          onClick={() => void openFile('open')}
        >
          <ExternalLink className="size-3.5" />
        </IconButton>
        <IconButton
          label={t('config.raw.reveal')}
          size="sm"
          disabled={!canonical.onDisk}
          onClick={() => void openFile('reveal')}
        >
          <FolderOpen className="size-3.5" />
        </IconButton>

        {/* Story 057 D3: the `unbindall` checkbox and the section header style select, each with
            its former help paragraph moved into a `HoverCard` tooltip instead. Neither control's
            IPC call/state wiring changed.

            Review fix (blocker 2, AC7): both controls end in `markUnsaved`, and sat outside
            `StructuredTabsGuard` (which only wraps the non-raw tab branch in `ConfigView` - it
            never covered this tab at all). Disabled here directly, driven by the same
            `useRawDraft().active` flag `StructuredTabsGuard` itself reads - otherwise a toggle made
            here while a raw draft is open would mark the profile dirty *and* keep the draft active
            at once, which is exactly the two-unsaved-truths state AC7 forbids (the save bar would
            show only the raw draft, and Save would silently drop the toggle).

            The lock reason (`config.raw.tabsLockedByDraft`, the identical string
            `StructuredTabsGuard`'s own hint paragraph uses) replaces each control's normal
            description in its existing `HoverCard` while the draft is active, rather than adding a
            *third* always-visible hint line next to the toolbar row's own path-row line above it
            and `StructuredTabsGuard`'s line elsewhere - the same information, through the one
            mechanism this row already had, not a new one. `RenameHeaderButton` (`ConfigView.tsx`)
            makes the identical trade for the same reason (its `title` swaps to this same string). */}
        <HoverCard
          content={
            <p className="text-xs leading-relaxed text-ink-muted">
              {rawDraft.active
                ? t('config.raw.tabsLockedByDraft')
                : t('config.raw.writeUnbindallHint')}
            </p>
          }
        >
          <Checkbox
            checked={profile.writeUnbindall !== false}
            onChange={(next) => void toggleWriteUnbindall(next)}
            label={t('config.raw.writeUnbindall')}
            disabled={rawDraft.active}
          />
        </HoverCard>
        <HoverCard
          content={
            <p className="text-xs leading-relaxed text-ink-muted">
              {rawDraft.active
                ? t('config.raw.tabsLockedByDraft')
                : t('config.raw.sectionHeaderStyleHint')}
            </p>
          }
        >
          <div className="flex items-center gap-1.5">
            <span id={sectionHeaderStyleLabelId} className="stencil shrink-0">
              {t('config.raw.sectionHeaderStyle')}
            </span>
            <Select
              aria-labelledby={sectionHeaderStyleLabelId}
              value={profile.sectionHeaderStyle ?? 'dashes'}
              onChange={(event) =>
                void changeSectionHeaderStyle(event.target.value as 'dashes' | 'brackets' | 'plain')
              }
              className="h-7 w-auto text-xs"
              disabled={rawDraft.active}
              options={[
                { value: 'dashes', label: t('config.raw.sectionHeaderStyleDashes') },
                { value: 'brackets', label: t('config.raw.sectionHeaderStyleBrackets') },
                { value: 'plain', label: t('config.raw.sectionHeaderStylePlain') },
              ]}
            />
          </div>
        </HoverCard>
      </div>

      {/* Story 057 D6: the raw save's read-back result - names the preserved-line count and any
          dropped-alias warnings, and stays until `rawDraft.setText` clears `lastResult` on the next
          edit (`lib/raw-draft.tsx`). Inline, not a toast: the toast path (`resolveRawSaveOutcome`)
          only ever fires for a *failed* save, so a successful one has no other surface today. */}
      {rawDraft.lastResult && (
        <Panel className="flex flex-col gap-1.5 px-3 py-2" data-testid="config-raw-save-result">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">
              {t('config.raw.result.preserved', { count: rawDraft.lastResult.preservedLines.length })}
            </Badge>
            {rawDraft.lastResult.droppedAliases.length > 0 && (
              <Badge tone="warning">
                {t('config.raw.result.aliasDropped', {
                  count: rawDraft.lastResult.droppedAliases.length,
                  names: rawDraft.lastResult.droppedAliases.join(', '),
                })}
              </Badge>
            )}
          </div>
        </Panel>
      )}

      {mode === 'lockedByChanges' && (
        <p className="text-xs text-ink-muted" data-testid="config-raw-locked-hint">
          {t('config.raw.editLockedByChanges')}
        </p>
      )}

      {mode === 'editable' ? (
        <div className="flex flex-1 min-h-0 flex-col" onKeyDown={handleEditorKeyDown}>
          <ConfigCodeView
            key={editorKey}
            className="flex-1 min-h-0"
            text={editorText}
            editable
            fill
            onChange={(next) => rawDraft.setText(next, canonical.content)}
          />
        </div>
      ) : (
        <ConfigCodeView className="flex-1 min-h-0" text={canonical.content} searchable fill />
      )}
    </div>
  )
}
