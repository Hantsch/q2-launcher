import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'

/**
 * A per-section error boundary for the server detail view, so a bad field in one section never
 * takes the others down with it.
 */
export function ServerDetailSection({ id, children }: { id: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <ErrorBoundary
      scope={`servers detail section ${id}`}
      fallback={
        <p data-testid={`servers-detail-section-error-${id}`}>{t('servers.detail.sectionError')}</p>
      }
    >
      {children}
    </ErrorBoundary>
  )
}
