import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleX, Clock, FileQuestion, TriangleAlert } from 'lucide-react'
import type { ConfigProfile, ProfileSyncState } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { Badge, SectionLabel, Spinner, type BadgeTone } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { getProfileSyncState, writeConfigProfile } from './client'
import type { CareSyncStatus } from './lib/care-summary'
import { toCareSyncRows, type CareSyncRow, type CareSyncState } from './lib/care-sync'

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
}: {
  profile: ConfigProfile
  onStatusChange?: (status: CareSyncStatus) => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const installations = useLauncher((state) => state.installations)

  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<Outcome<ProfileSyncState> | null>(null)
  const [retrying, setRetrying] = useState(false)

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
          />
        ))}
      </ul>
    </div>
  )
}

function SyncRow({
  row,
  installationName,
  retrying,
  onRetry,
}: {
  row: CareSyncRow
  installationName: string
  retrying: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const Icon = STATE_ICON[row.state]
  const tone = STATE_TONE[row.state]

  return (
    <li className="space-y-1 rounded-sm border border-line px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{installationName}</span>
        <Badge tone={tone} className="gap-1">
          <Icon className="size-3" />
          {t(`config.care.sync.state.${row.state}`)}
        </Badge>
        {row.state === 'failed' && (
          <Button variant="danger" size="sm" disabled={retrying} onClick={onRetry}>
            {retrying ? t('config.care.sync.retrying') : t('config.care.sync.retry')}
          </Button>
        )}
      </div>
      <p className={cn('numeric truncate text-xs text-ink-dim')} title={row.path} data-selectable>
        {row.path}
      </p>
      {row.messageKey && <p className="text-xs text-ink-muted">{t(row.messageKey)}</p>}
    </li>
  )
}
