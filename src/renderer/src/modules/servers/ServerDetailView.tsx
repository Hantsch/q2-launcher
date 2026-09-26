import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ServerOff, X } from 'lucide-react'
import type { ServerDetail } from '@shared/modules/servers'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/primitives'
import { onScanChanged, readServerDetail } from './client'
import { ServerDetailHeader } from './ServerDetailHeader'
import { ServerDetailSection } from './ServerDetailSection'
import { ServerPlayersPanel } from './ServerPlayersPanel'
import { ServerReachabilitySection } from './ServerReachabilitySection'
import { ServerRulesPanel } from './ServerRulesPanel'

export interface ServerDetailViewProps {
  address: string
  onClose: () => void
  /** Passed through to `ServerDetailHeader` - see its props. */
  onRefresh: () => void
  refreshDisabled: boolean
  refreshing: boolean
  /** A favourite toggle persisted - the list re-reads its rows (this pane re-reads its own). */
  onFavouriteChanged: () => void
}

type DetailState =
  { status: 'loading' } | { status: 'loaded'; detail: ServerDetail | null } | { status: 'error' }

/**
 * Story 122 D3: the detail container - reads `detail.read` for `address` on mount and whenever it
 * changes, and again whenever a `scan.changed` push reports a round that just finished (a new
 * `finishedAt`, mirroring `ServersView.tsx`'s own "a completed round is the moment to re-read"
 * discipline - still push-driven, never polled). A late response for an address that is no longer
 * current is ignored via `requestIdRef`, a generation counter bumped on every new request.
 *
 * `null` (the scan has no row for this address at all) renders `EmptyState`; a rejected read renders
 * one error line and never throws. Sections are wrapped individually in `ServerDetailSection` so one
 * bad field can't take the rest of the pane down, and stacked as hairline-divided blocks.
 */
export function ServerDetailView({
  address,
  onClose,
  onRefresh,
  refreshDisabled,
  refreshing,
  onFavouriteChanged,
}: ServerDetailViewProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const requestIdRef = useRef(0)
  const lastFinishedAtRef = useRef<string | null>(null)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setState({ status: 'loading' })

    void readServerDetail(address).then((result) => {
      if (requestIdRef.current !== requestId) return
      setState(result.ok ? { status: 'loaded', detail: result.value } : { status: 'error' })
    })
  }, [address])

  useEffect(() => {
    const unsubscribe = onScanChanged((scanState) => {
      if (scanState.running) return
      if (scanState.finishedAt === lastFinishedAtRef.current) return
      lastFinishedAtRef.current = scanState.finishedAt

      const requestId = ++requestIdRef.current
      void readServerDetail(address).then((result) => {
        if (requestIdRef.current !== requestId) return
        setState(result.ok ? { status: 'loaded', detail: result.value } : { status: 'error' })
      })
    })
    return unsubscribe
  }, [address])

  // A re-read after a favourite toggle keeps the loaded content on screen (no 'loading' flash).
  const handleFavouriteChanged = (): void => {
    const requestId = ++requestIdRef.current
    void readServerDetail(address).then((result) => {
      if (requestIdRef.current !== requestId) return
      setState(result.ok ? { status: 'loaded', detail: result.value } : { status: 'error' })
    })
    onFavouriteChanged()
  }

  return (
    <section aria-labelledby="servers-detail-title" data-testid="servers-detail">
      <div className="sticky top-0 z-10 flex h-9 items-center justify-between gap-2 border-b border-line bg-panel px-4">
        <h2 id="servers-detail-title" className="stencil">
          {t('servers.detail.title')}
        </h2>
        <IconButton
          label={t('servers.detail.close')}
          size="sm"
          onClick={onClose}
          data-testid="servers-detail-close"
        >
          <X className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>

      {state.status === 'loading' && null}

      {state.status === 'error' && (
        <p className="px-4 py-3 text-xs text-danger" data-testid="servers-detail-read-error">
          {t('servers.detail.readError')}
        </p>
      )}

      {state.status === 'loaded' && state.detail === null && (
        <EmptyState
          icon={<ServerOff className="size-6" aria-hidden="true" />}
          title={t('servers.detail.gone')}
        />
      )}

      {state.status === 'loaded' && state.detail !== null && (
        <div className="divide-y divide-line">
          <div className="px-4 py-4">
            <ServerDetailSection id="header">
              <ServerDetailHeader
                detail={state.detail}
                onRefresh={onRefresh}
                refreshDisabled={refreshDisabled}
                refreshing={refreshing}
                onFavouriteChanged={handleFavouriteChanged}
              />
            </ServerDetailSection>
          </div>
          <div className="px-4 py-4">
            <ServerDetailSection id="players">
              <ServerPlayersPanel row={state.detail.row} />
            </ServerDetailSection>
          </div>
          <div className="px-4 py-4">
            <ServerDetailSection id="rules">
              <ServerRulesPanel serverinfo={state.detail.serverinfo ?? undefined} />
            </ServerDetailSection>
          </div>
          <div className="px-4 py-4">
            <ServerDetailSection id="reachability">
              <ServerReachabilitySection entry={state.detail.row} />
            </ServerDetailSection>
          </div>
        </div>
      )}
    </section>
  )
}
