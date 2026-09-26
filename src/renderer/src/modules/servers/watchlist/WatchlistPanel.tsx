import { useEffect, useState, type ReactNode } from 'react'
import type { ServerListRow, WatchlistMatch } from '@shared/modules/servers'
import { useWatchlist } from './useWatchlist'
import { WatchlistAddForm } from './WatchlistAddForm'
import { WatchlistRow } from './WatchlistRow'

/** How often the panel re-renders purely to keep its relative-time strings ("seen 2m ago") fresh -
 * nothing else depends on this tick, `formatRelativeTime` is recomputed at render time. */
const RELATIVE_TIME_REFRESH_MS = 30_000

export interface WatchlistPanelProps {
  /** Renders the join/open-detail actions for one match - a later deliverable (D3) wires
   * this to the real server-list actions. Defaults to nothing, keeping this panel free of any
   * join/spectate concept of its own (AC4). */
  renderMatchActions?: (match: WatchlistMatch) => ReactNode
  /** The server list's live row for an address, shown as a match's server stats - defaults to
   * knowing no server, in which case every stat renders `—`. */
  resolveServer?: (address: string) => ServerListRow | undefined
  /** The address open in the watchlist's detail pane, highlighted among the matches. */
  selectedAddress?: string | null
}

/**
 * Story 132 D2: the watchlist panel - not yet wired into `ServersView.tsx` (that's D3). Composes
 * the add form and one `WatchlistRow` per entry from `useWatchlist()`'s live snapshot.
 */
export function WatchlistPanel({
  renderMatchActions = () => null,
  resolveServer = () => undefined,
  selectedAddress = null,
}: WatchlistPanelProps) {
  const { snapshot, add, update, remove, recheck } = useWatchlist()

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((value) => value + 1), RELATIVE_TIME_REFRESH_MS)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-3" data-testid="servers-watchlist">
      <WatchlistAddForm add={add} />

      <div className="space-y-2">
        {snapshot?.entries.map((status) => (
          <WatchlistRow
            key={status.entry.id}
            status={status}
            asOf={snapshot.asOf}
            update={update}
            remove={remove}
            recheck={recheck}
            renderMatchActions={renderMatchActions}
            resolveServer={resolveServer}
            selectedAddress={selectedAddress}
          />
        ))}
      </div>
    </div>
  )
}
