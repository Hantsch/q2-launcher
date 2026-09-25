import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  id: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Story 122 D3: a per-section error boundary for the server detail view - mirrors
 * `src/renderer/src/components/ErrorBoundary.tsx`'s shape exactly (`getDerivedStateFromError`,
 * `componentDidCatch` logging), but scoped to one section of the detail pane rather than the whole
 * renderer, so a bad field in one section (header, and later players/admin) never takes the others
 * down with it.
 */
class ServerDetailSectionBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[servers] detail section crashed', this.props.id, error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return <ServerDetailSectionError id={this.props.id} />
  }
}

function ServerDetailSectionError({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <p data-testid={`servers-detail-section-error-${id}`}>{t('servers.detail.sectionError')}</p>
  )
}

export function ServerDetailSection({ id, children }: Props) {
  return <ServerDetailSectionBoundary id={id}>{children}</ServerDetailSectionBoundary>
}
