import { useTranslation } from 'react-i18next'
import type { ConfigProfile, ProfileSyncState } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { Badge, type BadgeTone } from '../../../components/ui/primitives'
import { useLauncher } from '../../../store/useLauncher'
import { getProfileSyncState, listConfigProfiles } from '../../config/client'
import type { CareSyncState } from '../../config/lib/care-sync'
import { DashboardTileFrame } from '../components/DashboardTileFrame'
import { useTileData } from '../components/useTileData'
import { toConfigProfileRows, type ConfigProfileRow } from './profile-rows'

interface ConfigProfilesData {
  profiles: ConfigProfile[]
  /** Index-aligned with `profiles` - `undefined` marks a profile whose own `getProfileSyncState`
   * call rejected or came back `!ok` (see `fetchConfigProfilesData` below). */
  syncStates: Array<ProfileSyncState | undefined>
}

/**
 * Unwraps `listConfigProfiles()`'s `Outcome` for `useTileData` - a failed call throws so the hook's
 * `state` becomes `'error'`, per that hook's contract (mirrors `PlaytimeTile.tsx`'s
 * `fetchPlaytimeStats`).
 *
 * Per-profile `getProfileSyncState` calls are fetched together via `Promise.all` (Decision
 * (Sprint): reuse the existing renderer clients rather than adding a batch IPC handler), but a
 * single profile's fetch failing - rejecting, or resolving to `!ok` - must not fail the whole tile:
 * each call is caught individually and turned into `undefined` at that profile's index, which
 * `profile-rows.ts` renders as a `failed` row rather than dropping the profile.
 */
async function fetchConfigProfilesData(): Promise<ConfigProfilesData> {
  const result = await listConfigProfiles()
  if (!result.ok) throw new Error(result.error.key)
  const profiles = result.value

  const syncStates = await Promise.all(
    profiles.map(async (profile): Promise<ProfileSyncState | undefined> => {
      try {
        const sync = await getProfileSyncState({ profileId: profile.id })
        return sync.ok ? sync.value : undefined
      } catch {
        return undefined
      }
    }),
  )

  return { profiles, syncStates }
}

const STATE_TONE: Record<CareSyncState, BadgeTone> = {
  inSync: 'success',
  outOfSync: 'warning',
  missing: 'warning',
  failed: 'danger',
}

/**
 * Story 087 D4 (AC2/AC4): the dashboard's config profiles tile. Composes `useTileData`'s
 * loading/error/success with its own "zero profiles" empty check into `DashboardTileFrame`'s
 * four-way state - same shape as `PlaytimeTile.tsx`.
 *
 * Decision (Sprint): config profiles only, never grouped/filtered by installation - one row per
 * profile, each showing its own file's sync state and the worst of its installation copies' care
 * state (`profile-rows.ts`).
 */
export function ConfigProfilesTile() {
  const { t } = useTranslation()
  const setRoute = useLauncher((state) => state.setRoute)
  const { state, data, retry } = useTileData(fetchConfigProfilesData)
  const title = t('home.dashboard.tiles.configProfiles.title')

  if (state === 'loading') return <DashboardTileFrame title={title} state="loading" />
  if (state === 'error') return <DashboardTileFrame title={title} state="error" onRetry={retry} />

  const rows = data ? toConfigProfileRows(data.profiles, data.syncStates) : []

  if (rows.length === 0) {
    return (
      <DashboardTileFrame
        title={title}
        state="empty"
        empty={{
          title: t('home.dashboard.tiles.configProfiles.empty.title'),
          body: t('home.dashboard.tiles.configProfiles.empty.body'),
          actions: (
            <Button
              variant="primary"
              size="sm"
              data-testid="config-profiles-tile-empty-action"
              onClick={() => setRoute('/config')}
            >
              {t('home.dashboard.tiles.configProfiles.empty.action')}
            </Button>
          ),
        }}
      />
    )
  }

  // Story 087 D5 (AC2): the clicked profile's id rides along as the shell's one-shot route focus,
  // which `ConfigView` consumes on mount to land in that profile's editor rather than on the list.
  const onOpenProfile = (profileId: string): void => setRoute('/config', profileId)

  return (
    <DashboardTileFrame title={title} state="filled">
      <ul
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
        data-testid="config-profiles-tile-list"
        tabIndex={0}
      >
        {rows.map((row) => (
          <ConfigProfileRowItem key={row.id} row={row} onOpen={() => onOpenProfile(row.id)} />
        ))}
      </ul>
    </DashboardTileFrame>
  )
}

function ConfigProfileRowItem({
  row,
  onOpen,
}: {
  row: ConfigProfileRow
  onOpen: () => void
}) {
  const { t } = useTranslation()

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`config-profiles-tile-row-${row.id}`}
        className="flex w-full items-center justify-between gap-2 rounded-sm border border-line bg-panel px-2 py-1.5 text-left hover:bg-hover"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-ink" data-selectable>
          {row.name}
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-1">
          <Badge tone={STATE_TONE[row.own]} testId={`config-profiles-tile-own-${row.id}`}>
            {t('home.dashboard.tiles.configProfiles.own.label')}:{' '}
            {t(`home.dashboard.tiles.configProfiles.state.${row.own}`)}
          </Badge>
          <Badge
            tone={STATE_TONE[row.installations]}
            testId={`config-profiles-tile-installations-${row.id}`}
          >
            {t('home.dashboard.tiles.configProfiles.installations.label')}:{' '}
            {t(`home.dashboard.tiles.configProfiles.state.${row.installations}`)}
          </Badge>
        </span>
      </button>
    </li>
  )
}
