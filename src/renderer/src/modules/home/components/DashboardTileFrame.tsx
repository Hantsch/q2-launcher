import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../lib/cn'
import { Button } from '../../../components/ui/Button'
import { ErrorBoundary } from '../../../components/ui/ErrorBoundary'
import { EmptyState, Spinner } from '../../../components/ui/primitives'

/**
 * Story 087. Content handed to the `empty` state - the same shape `EmptyState`
 * (`components/ui/primitives.tsx`) already takes, minus `className` (the frame owns that).
 */
export interface DashboardTileFrameEmptyContent {
  title: string
  body?: string
  hint?: string
  actions?: ReactNode
  icon?: ReactNode
}

type DashboardTileFrameStateProps =
  | { state: 'loading' }
  | {
      state: 'error'
      /** Calls back into whatever produced the error - `useTileData`'s `retry`, typically. */
      onRetry: () => void
      /** Optional override for the generic message; most tiles can omit this. */
      message?: string
    }
  | { state: 'empty'; empty: DashboardTileFrameEmptyContent }
  | { state: 'filled'; children: ReactNode }

export type DashboardTileFrameProps = {
  /**
   * Rendered as the frame's own heading. Separate from, and in addition to, whatever
   * `DashboardTile.tsx` renders around a tile elsewhere in the grid - this frame is self-contained
   * and unit-tested on its own, so it does not rely on a heading owned by its eventual host.
   */
  title: string
  className?: string
  /** Root `data-testid`; defaults to a fixed value so a lone frame is easy to query in tests. */
  testId?: string
} & DashboardTileFrameStateProps

/**
 * Story 087: the ONE shared frame every dashboard tile body renders through. Four explicit,
 * mutually exclusive states - loading, error (with a working retry), empty (a sentence and an
 * action, via the existing `EmptyState` primitive), filled (arbitrary children) - plus its own error
 * boundary around the filled path, so a throwing tile body cannot unmount the whole dashboard grid
 * (Decisions (Sprint)).
 *
 * ## Prop contract for sibling deliverables (Playtime, Config profiles tiles)
 *
 * `useTileData<T>()` (`./useTileData.ts`) only ever knows `'loading' | 'error' | 'success'` - it
 * cannot know whether a successful result is semantically "empty" (zero installations, no config
 * profiles), because that judgement is specific to each tile's data shape. So this frame takes the
 * *resolved*, four-way `state` directly (a discriminated union on `state`), and a tile body composes
 * its own four-way state from `useTileData` plus its own `isEmpty(data)` check, e.g.:
 *
 * ```tsx
 * const { state, data, error, retry } = useTileData(fetchPlaytimeSummary)
 *
 * if (state === 'loading') return <DashboardTileFrame title={title} state="loading" />
 * if (state === 'error') return <DashboardTileFrame title={title} state="error" onRetry={retry} />
 * if (isEmpty(data)) {
 *   return (
 *     <DashboardTileFrame
 *       title={title}
 *       state="empty"
 *       empty={{ title: t('...'), body: t('...'), actions: <Button onClick={...}>...</Button> }}
 *     />
 *   )
 * }
 * return (
 *   <DashboardTileFrame title={title} state="filled">
 *     <PlaytimeSummaryView data={data} />
 *   </DashboardTileFrame>
 * )
 * ```
 *
 * This was picked over accepting `useTileData`'s raw `state`/`error`/`retry` directly (with an
 * internal `isEmpty` prop) because that would still force every tile to hand over a callback the
 * frame invokes on its behalf, for no less code at the call site - the plain if/else above is exactly
 * as short and keeps the frame's own prop type a single, exhaustively-checked union instead of a
 * grab-bag of "only used for some states" optional props.
 *
 * ## Error boundary
 *
 * Only the `filled` path can run arbitrary tile-body code, so only it is wrapped (`ErrorBoundary`).
 * Its fallback is its own minimal message with a "try again" button that clears the caught error and
 * re-attempts rendering `children` - it does not reuse the `error` state's `onRetry` callback, which
 * belongs to `useTileData` and would not fix a render fault anyway (the data was fine; the render
 * wasn't). If a tile's `children` reference stays the same across a retry that doesn't actually fix
 * the fault, clicking it again is harmless - it just re-runs the same failing render once more.
 */
export function DashboardTileFrame(props: DashboardTileFrameProps): ReactNode {
  const { title, className, testId = 'dashboard-tile-frame' } = props
  const { t } = useTranslation()

  return (
    <div
      data-testid={testId}
      data-tile-state={props.state}
      className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}
    >
      <h2 className="min-w-0 shrink-0 truncate font-display text-xs tracking-[0.08em] text-ink-dim uppercase">
        {title}
      </h2>
      <div className="flex min-h-0 flex-1 flex-col">{renderTileFrameState(props, t)}</div>
    </div>
  )
}

function renderTileFrameState(props: DashboardTileFrameProps, t: TFunction): ReactNode {
  switch (props.state) {
    case 'loading':
      return (
        <div
          data-testid="dashboard-tile-frame-loading"
          className="flex flex-1 items-center justify-center gap-2 text-xs text-ink-muted"
        >
          <Spinner />
          <span>{t('common.label.loading')}</span>
        </div>
      )

    case 'error':
      return (
        <TileFrameErrorFallback
          testId="dashboard-tile-frame-error"
          message={props.message ?? t('home.dashboard.tileFrame.error')}
          retryLabel={t('common.action.retry')}
          onRetry={props.onRetry}
        />
      )

    case 'empty':
      return (
        <div data-testid="dashboard-tile-frame-empty" className="flex flex-1 flex-col">
          <EmptyState
            className="flex-1"
            title={props.empty.title}
            body={props.empty.body}
            hint={props.empty.hint}
            actions={props.empty.actions}
            icon={props.empty.icon}
          />
        </div>
      )

    case 'filled':
      return (
        <ErrorBoundary
          scope="dashboard tile"
          fallback={(_error, reset) => (
            <TileFrameErrorFallback
              testId="dashboard-tile-frame-error"
              message={t('home.dashboard.tileFrame.renderError')}
              retryLabel={t('common.action.retry')}
              onRetry={reset}
            />
          )}
        >
          <div data-testid="dashboard-tile-frame-filled" className="flex min-h-0 flex-1 flex-col">
            {props.children}
          </div>
        </ErrorBoundary>
      )
  }
}

function TileFrameErrorFallback({
  testId,
  message,
  retryLabel,
  onRetry,
}: {
  testId: string
  message: string
  retryLabel: string
  onRetry: () => void
}): ReactNode {
  return (
    <div
      data-testid={testId}
      className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center"
    >
      <p className="text-sm text-ink-dim">{message}</p>
      <Button size="sm" onClick={onRetry} data-testid="dashboard-tile-frame-retry">
        {retryLabel}
      </Button>
    </div>
  )
}
