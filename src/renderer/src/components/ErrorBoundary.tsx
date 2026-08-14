import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence for the renderer.
 *
 * A crash inside a view must not leave the user with a black window and no way
 * out, so this renders the error and a reload button. Strings are hardcoded
 * English: if the i18n bundle is what broke, translating the error message would
 * fail too.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] unhandled error', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

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
