import { useTranslation } from 'react-i18next'
import type { BootstrapSummary } from '@shared/modules/downloads'
import { formatBytes } from '../../../lib/format'
import { Checkbox } from '../../../components/ui/controls'
import { KeyValue, Panel, SectionLabel } from '../../../components/ui/primitives'

/**
 * Story 074 D6, step 3: names every package the bootstrap would download, the summed size and
 * the target path (AC4), plus the AC7 video/players toggle - off by default (Decisions
 * (Sprint): "most players only want multiplayer and treat the cinematics as dead weight").
 *
 * `data-testid`s: `bootstrap-confirm-total-size`, `bootstrap-confirm-target-path`.
 */
export function ConfirmStep({
  summary,
  loading,
  includeVideoAndPlayers,
  onIncludeVideoAndPlayersChange,
}: {
  summary: BootstrapSummary | null
  loading: boolean
  includeVideoAndPlayers: boolean
  onIncludeVideoAndPlayersChange: (next: boolean) => void
}) {
  const { t } = useTranslation()

  if (loading || !summary) {
    return <p className="text-xs text-ink-muted">{t('bootstrapWizard.confirm.loading')}</p>
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionLabel>{t('bootstrapWizard.confirm.packagesTitle')}</SectionLabel>
        <Panel className="space-y-1.5 p-3">
          {summary.packages.map((pkg) => (
            <div key={pkg.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-ink-dim">
                {t(`bootstrapWizard.confirm.role.${pkg.role}`)} - {pkg.id} ({pkg.version})
              </span>
              <span className="numeric shrink-0 text-ink-muted">{formatBytes(pkg.sizeBytes)}</span>
            </div>
          ))}
        </Panel>
      </div>

      <Panel className="space-y-1.5 p-3">
        <KeyValue label={t('bootstrapWizard.confirm.totalSizeLabel')}>
          <span data-testid="bootstrap-confirm-total-size">{formatBytes(summary.totalSizeBytes)}</span>
        </KeyValue>
        <KeyValue label={t('bootstrapWizard.confirm.targetLabel')}>
          <span data-testid="bootstrap-confirm-target-path" title={summary.targetPath}>
            {summary.targetPath}
          </span>
        </KeyValue>
      </Panel>

      <Checkbox
        checked={includeVideoAndPlayers}
        onChange={onIncludeVideoAndPlayersChange}
        label={t('bootstrapWizard.confirm.includeExtras')}
      />
      <p className="text-xs leading-relaxed text-ink-muted">
        {t('bootstrapWizard.confirm.includeExtrasHint')}
      </p>
    </div>
  )
}
