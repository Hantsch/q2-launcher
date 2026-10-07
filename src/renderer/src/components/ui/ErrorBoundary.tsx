import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  onError?: (error: Error, info: ErrorInfo) => void
  /** A change (`Object.is`, per entry) in any key clears a caught error. */
  resetKeys?: readonly unknown[]
  /** Log prefix; defaults to `renderer`. */
  scope?: string
}

interface State {
  error: Error | null
}

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))
}

/**
 * The renderer's one error boundary. Without a `fallback` it renders the app-level crash screen
 * with a reload button; strings there are hardcoded English because a broken i18n bundle must not
 * break the error screen too.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.scope ?? 'renderer'}] unhandled error`, error, info.componentStack)
    this.props.onError?.(error, info)
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && keysChanged(prev.resetKeys, this.props.resetKeys)) this.reset()
  }

  private readonly reset = (): void => this.setState({ error: null })

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const { fallback } = this.props
    if (typeof fallback === 'function') return fallback(error, this.reset)
    if (fallback !== undefined) return fallback

    return (
      <div className="app-backdrop flex h-full items-center justify-center p-8">
        <div className="panel-raised max-w-lg space-y-4 rounded-md p-6">
          <h1 className="font-display text-lg tracking-wide text-danger uppercase">
            The launcher hit an unexpected error
          </h1>
          <p className="text-sm leading-relaxed text-ink-dim">
            This is a bug. Reloading usually helps; the details below are worth attaching to a
            report.
          </p>
          <pre
            className="numeric max-h-52 overflow-auto rounded-sm border border-line bg-void p-3 text-[11px] whitespace-pre-wrap text-ink-muted"
            data-selectable
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-play"
            style={{ minWidth: '10rem', height: '2.5rem', fontSize: '0.875rem' }}
          >
            Reload launcher
          </button>
        </div>
      </div>
    )
  }
}
