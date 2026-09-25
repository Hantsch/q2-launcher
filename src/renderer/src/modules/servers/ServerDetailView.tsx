import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ServerOff } from 'lucide-react'
import type { ServerDetail } from '@shared/modules/servers'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/primitives'
import { onScanChanged, readServerDetail } from './client'
import { ServerDetailHeader } from './ServerDetailHeader'
import { ServerDetailSection } from './ServerDetailSection'
import { ServerPlayersPanel } from './ServerPlayersPanel'

export interface ServerDetailViewProps {
  address: string
  onClose: () => void
}

type DetailState =
  | { status: 'loading' }
  | { status: 'loaded'; detail: ServerDetail | null }
  | { status: 'error' }

/**
 * Story 122 D3: the detail container - reads `detail.read` for `address` on mount and whenever it
 * changes, and again whenever a `scan.changed` push reports a round that just finished (a new
 * `finishedAt`, mirroring `ServersView.tsx`'s own "a completed round is the moment to re-read"
 * discipline - still push-driven, never polled). A late response for an address that is no longer
 * current is ignored via `requestIdRef`, a generation counter bumped on every new request.
 *
 * `null` (the scan has no row for this address at all) renders `EmptyState`; a rejected read renders
 * one error line and never throws. Sections are wrapped individually in `ServerDetailSection` so one
 * bad field can't take the rest of the pane down.
 *
 * Later deliverables (123: players, 124: admin/actions) append more `ServerDetailSection`-wrapped
 * sections below the header the same way - this file's shape does not need to change for them.
 */
export function ServerDetailView({ address, onClose }: ServerDetailViewProps) {
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

  return (
    <section aria-labelledby="servers-detail-title" data-testid="servers-detail">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="servers-detail-title" className="font-display text-sm tracking-wide text-ink uppercase">
          {t('servers.detail.title')}
        </h2>
        <IconButton
          label={t('servers.detail.close')}
          onClick={onClose}
          data-testid="servers-detail-close"
          className="min-h-11"
        >
          ×
        </IconButton>
      </div>

      {state.status === 'loading' && null}

      {state.status === 'error' && (
        <p className="text-xs text-danger" data-testid="servers-detail-read-error">
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
        <>
          <ServerDetailSection id="header">
            <ServerDetailHeader detail={state.detail} />
          </ServerDetailSection>
          <ServerDetailSection id="players">
            <ServerPlayersPanel row={state.detail.row} />
          </ServerDetailSection>
        </>
      )}
    </section>
  )
}
