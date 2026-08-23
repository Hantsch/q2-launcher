import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleX, Clock, FileQuestion, PencilLine, TriangleAlert } from 'lucide-react'
import type { ConfigProfile, ProfileSyncState, SaveProfileConflict } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Badge, SectionLabel, Spinner, type BadgeTone } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { ConfigConflictDialog } from './ConfigConflictDialog'
import { getProfileSyncState, refreshProfilesFromFiles, saveConfigProfile, writeConfigProfile } from './client'
import type { CareSyncStatus } from './lib/care-summary'
import {
  canonicalOutOfSyncReason,
  toCareSyncRows,
  type CanonicalOutOfSyncReason,
  type CareSyncRow,
  type CareSyncState,
} from './lib/care-sync'
import { resolveSaveOutcome } from './lib/save-bar'

const STATE_ICON: Record<CareSyncState, typeof CircleCheck> = {
  inSync: CircleCheck,
  outOfSync: TriangleAlert,
  missing: FileQuestion,
  failed: CircleX,
  pending: Clock,
}

const STATE_TONE: Record<CareSyncState, BadgeTone> = {
  inSync: 'success',
  outOfSync: 'warning',
  missing: 'neutral',
  failed: 'danger',
  pending: 'neutral',
}

/**
 * Care tab, Sync section (story 025 D2): one row for the profile's own
 * canonical file, then one row per assigned installation, each showing its
 * live sync state via `toCareSyncRows` (`lib/care-sync.ts`). Every row's
 * indicator pairs an icon with a text label (never colour alone), same rule
 * `ChecksList`/`ValidationPanel` already follow.
 *
 * Owns its own fetch, same idiom as `RawFileTab`: reads on mount and
 * re-reads on a profile switch or save (`profile.id`/`profile.updatedAt`).
 * A `failed` row gets a retry button that re-runs the write pipeline for the
 * whole profile (`writeConfigProfile` - the same call an ordinary write
 * makes, there is no per-installation retry endpoint) and then re-fetches
 * this section's own state so success clears the row immediately rather
 * than waiting for something else to trigger a refetch.
 *
 * Story 025 D8: `onStatusChange`, fired with a `CareSyncStatus` whenever this
 * section's own fetch settles, lets `CareTab`'s summary fold sync into its
 * "all clear" rollup without a second IPC call or a second copy of this
 * adapter - optional, so anyone mounting this section without the prop sees
 * no change at all. Story 025 review finding F3: a failed fetch DOES call it
 * now, with `{ kind: 'error' }` - the summary must render something for sync
 * even when the fetch fails, rather than the whole Care summary panel
 * disappearing because `syncRows` never resolved. `{ kind: 'loading' }` is
 * never posted here (`CareTab` starts in that state itself before this
 * section's first callback arrives); only `'loaded'`/`'error'` are reported.
 */
export function CareSyncSection({
  profile,
  onStatusChange,
  onProfileUpdated,
}: {
  profile: ConfigProfile
  onStatusChange?: (status: CareSyncStatus) => void
  /**
   * Story 043 D9: the single-profile merge-by-id callback (`ConfigView.handleProfileUpdated`)
   * both Reload and Compare's resolutions need to propagate an adopted/overwritten profile to the
   * rest of the UI. Required, unlike `onStatusChange` above - skipping it would leave the rest of
   * the UI (Settings/Controls tabs) showing a stale profile after either action lands.
   */
  onProfileUpdated: (profile: ConfigProfile) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const installations = useLauncher((state) => state.installations)

  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<Outcome<ProfileSyncState> | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [canonicalBusy, setCanonicalBusy] = useState<'reload' | 'compare' | null>(null)
  const [conflict, setConflict] = useState<SaveProfileConflict | null>(null)

  const fetchSyncState = useCallback(
    async (guard?: { cancelled: boolean }): Promise<void> => {
      const outcome = await getProfileSyncState({ profileId: profile.id })
      if (guard?.cancelled) return
      setResult(outcome)
      setLoading(false)
      if (outcome.ok) {
        onStatusChange?.({ kind: 'loaded', rows: toCareSyncRows(outcome.value) })
      } else {
        onStatusChange?.({ kind: 'error' })
      }
    },
    [profile.id, onStatusChange],
  )

  // Re-reads on a profile switch AND on a save (`updatedAt` bump), same idiom as `RawFileTab`
  // (AC 7 there: switching profiles or installations re-reads rather than showing a stale copy).
  useEffect(() => {
    const guard = { cancelled: false }
    setLoading(true)
    setResult(null)
    void fetchSyncState(guard)
    return () => {
      guard.cancelled = true
    }
    // profile.updatedAt is read only to trigger a re-fetch on save; fetchSyncState itself already
    // captures profile.id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSyncState, profile.updatedAt])

  const retry = async (): Promise<void> => {
    setRetrying(true)
    const outcome = await writeConfigProfile({ profileId: profile.id })
    if (outcome.ok) {
      await fetchSyncState()
    } else {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
    }
    setRetrying(false)
  }

  /**
   * The canonical row's "Reload" action (story 043 D9, `externalEdit` case): adopts whatever is
   * on disk right now through D5/D7's existing `refreshFromFiles` adoption path - no
   * `discardLocalEdits` needed, this action is only offered when `profile.dirty` is falsy. Mirrors
   * `ConfigConflictDialog.takeFile`'s own doc comment on why this is a fresh read rather than a
   * replay of anything already shown: the file could in principle have moved again since this
   * section's last fetch.
   */
  const handleReload = async (): Promise<void> => {
    setCanonicalBusy('reload')
    const outcome = await refreshProfilesFromFiles({ profileId: profile.id })
    setCanonicalBusy(null)

    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
      return
    }
    const entry = outcome.value.find((item) => item.profileId === profile.id)
    if (entry?.outcome === 'adopted') {
      onProfileUpdated(entry.profile)
    }
    // Whatever the outcome - adopted, or the rare race where the file moved again between this
    // section's last fetch and this click (unchanged/missing/unparseable/readError) - re-fetch so
    // the row reflects the file's real current state rather than staying on the stale `outOfSync`
    // this button was clicked from.
    await fetchSyncState()
  }

  /**
   * The canonical row's "Compare" action (story 043 D9, `externalEdit` case): calls `save` without
   * `force` purely to obtain the same `SaveProfileConflict` payload `ConfigConflictDialog` already
   * knows how to render - a refusal touches neither cache nor disk, and there is nothing to lose
   * since the profile is not dirty on this path. `resolveSaveOutcome` (`lib/save-bar.ts`, D6/D8) is
   * reused rather than re-classified here, same as `ProfileSaveBar`'s own save flow.
   */
  const handleCompare = async (): Promise<void> => {
    setCanonicalBusy('compare')
    const outcome = await saveConfigProfile({ profileId: profile.id })
    setCanonicalBusy(null)

    const action = resolveSaveOutcome(outcome)
    if (action.type === 'saved') {
      // The file turned out to already match (or became writable) between this section's last
      // fetch and this click, e.g. it reverted back on disk - nothing left to compare. Adopt the
      // (harmless, unforced) write's own result and refresh rather than opening a dialog with a
      // payload that no longer applies.
      onProfileUpdated(action.profile)
      await fetchSyncState()
      return
    }
    if (action.type === 'conflict') {
      setConflict(action.conflict)
      return
    }
    pushToast({
      level: 'error',
      messageKey: action.messageKey,
      timeoutMs: 0,
      ...(action.params ? { params: action.params } : {}),
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner />
      </div>
    )
  }

  if (result && !result.ok) {
    return <p className="text-sm text-danger">{t(result.error.key, result.error.params)}</p>
  }

  if (!result) return null

  const rows = toCareSyncRows(result.value)

  return (
    <div className="space-y-2">
      <SectionLabel>{t('config.care.sync.label')}</SectionLabel>
      <ul className="space-y-2">
        {rows.map((row) => (
          <SyncRow
            key={row.target}
            row={row}
            installationName={
              row.target === 'canonical'
                ? t('config.care.sync.own')
                : installations.find((installation) => installation.id === row.target)?.name ??
                  row.target
            }
            retrying={retrying}
            onRetry={() => void retry()}
            canonicalReason={canonicalOutOfSyncReason(row, profile.dirty)}
            canonicalBusy={canonicalBusy}
            onReload={() => void handleReload()}
            onCompare={() => void handleCompare()}
          />
        ))}
      </ul>

      {conflict && (
        <ConfigConflictDialog
          profileId={profile.id}
          conflict={conflict}
          onClose={() => setConflict(null)}
          onResolved={(resolved) => {
            setConflict(null)
            onProfileUpdated(resolved)
            void fetchSyncState()
          }}
        />
      )}
    </div>
  )
}

function SyncRow({
  row,
  installationName,
  retrying,
  onRetry,
  canonicalReason,
  canonicalBusy,
  onReload,
  onCompare,
}: {
  row: CareSyncRow
  installationName: string
  retrying: boolean
  /**
   * Story 043 D9: set only for the canonical row when its `outOfSync` state has a specific cause
   * (`canonicalOutOfSyncReason`, `lib/care-sync.ts`) - undefined for every installation row and
   * for every other canonical state, which keep exactly today's rendering below.
   */
  canonicalReason?: CanonicalOutOfSyncReason
  canonicalBusy?: 'reload' | 'compare' | null
  onReload?: () => void
  onCompare?: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  // Story 043 D9: the canonical row's `outOfSync` state has its own icon/label/hint for each
  // `canonicalReason` - `unsavedChanges` reads as normal in-progress editing (the same
  // pencil-icon idiom `ProfileSaveBar`'s own "Unsaved changes" badge uses), never as a broken
  // file; `externalEdit` keeps the ordinary warning triangle, since it genuinely is something to
  // look at, just not a failure. Every other row/state (including every installation row) falls
  // through to exactly today's rendering.
  const Icon = canonicalReason === 'unsavedChanges' ? PencilLine : STATE_ICON[row.state]
  const tone = STATE_TONE[row.state]
  const label = canonicalReason
    ? t(`config.care.sync.canonical.${canonicalReason}`)
    : t(`config.care.sync.state.${row.state}`)
  const hintKey = canonicalReason ? `config.care.sync.canonical.${canonicalReason}Hint` : null

  return (
    <li className="space-y-1 rounded-sm border border-line px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{installationName}</span>
        <Badge tone={tone} className="gap-1">
          <Icon className="size-3" />
          {label}
        </Badge>
        {row.state === 'failed' && (
          <Button variant="danger" size="sm" disabled={retrying} onClick={onRetry}>
            {retrying ? t('config.care.sync.retrying') : t('config.care.sync.retry')}
          </Button>
        )}
        {canonicalReason === 'externalEdit' && (
          <>
            <Button
              variant="neutral"
              size="sm"
              disabled={canonicalBusy != null}
              onClick={onReload}
            >
              {canonicalBusy === 'reload'
                ? t('config.care.sync.canonical.reloading')
                : t('config.care.sync.canonical.reload')}
            </Button>
            <Button
              variant="neutral"
              size="sm"
              disabled={canonicalBusy != null}
              onClick={onCompare}
            >
              {canonicalBusy === 'compare'
                ? t('config.care.sync.canonical.comparing')
                : t('config.care.sync.canonical.compare')}
            </Button>
          </>
        )}
      </div>
      <p className={cn('numeric truncate text-xs text-ink-dim')} title={row.path} data-selectable>
        {row.path}
      </p>
      {hintKey && <p className="text-xs text-ink-muted">{t(hintKey)}</p>}
      {row.messageKey && <p className="text-xs text-ink-muted">{t(row.messageKey)}</p>}
    </li>
  )
}
