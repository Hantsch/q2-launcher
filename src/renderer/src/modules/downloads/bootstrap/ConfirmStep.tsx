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
 * Story 088 D5 (AC5): for a `'store-copy'` summary, adds a line naming the copy source
 * (`summary.copySource`) above the packages panel - which, for that data source, already lists
 * the engine build alone (`buildBootstrapSummary`, main). The free-download rendering is
 * unchanged.
 *
 * Story 089 D5 (AC6): widens that same line to a `'existing-folder'` summary too -
 * `summary.copySource` is populated the same way for that data source (`buildBootstrapSummary`),
 * just without a `store`, so the store-name span is skipped rather than rendering "undefined".
 *
 * Story 088 D5 (toggle availability rule): `includeExtrasDisabledReason`, when set, disables the
 * video/players checkbox and shows the reason instead of the usual hint - the wizard computes this
 * from the chosen detected source's `hasVideo`/`hasPlayers`, this component only renders it.
 *
 * Story 089 D5 (Decisions: "no video/players toggle for this source"): `hideIncludeExtras`, when
 * true, omits the checkbox row entirely rather than rendering it disabled - an existing-folder run
 * never offers the toggle at all, unlike a `'store-copy'` run where it stays visible but may be
 * disabled per source.
 *
 * `data-testid`s: `bootstrap-confirm-total-size`, `bootstrap-confirm-target-path`,
 * `bootstrap-confirm-copy-source` (present for a `'store-copy'` or `'existing-folder'` summary),
 * `bootstrap-confirm-include-extras-disabled` (present only when disabled).
 */
export function ConfirmStep({
  summary,
  loading,
  includeVideoAndPlayers,
  onIncludeVideoAndPlayersChange,
  includeExtrasDisabledReason,
  hideIncludeExtras,
}: {
  summary: BootstrapSummary | null
  loading: boolean
  includeVideoAndPlayers: boolean
  onIncludeVideoAndPlayersChange: (next: boolean) => void
  includeExtrasDisabledReason?: string
  hideIncludeExtras?: boolean
}) {
  const { t } = useTranslation()

  if (loading || !summary) {
    return <p className="text-xs text-ink-muted">{t('bootstrapWizard.confirm.loading')}</p>
  }

  return (
    <div className="space-y-4">
      {(summary.dataSource === 'store-copy' || summary.dataSource === 'existing-folder') &&
        summary.copySource && (
          <Panel className="space-y-1.5 p-3" data-testid="bootstrap-confirm-copy-source">
            <KeyValue label={t('bootstrapWizard.confirm.copySourceLabel')}>
              <span title={summary.copySource.path}>
                {summary.copySource.store
                  ? t('bootstrapWizard.gameData.store.' + summary.copySource.store) + ' '
                  : null}
                {summary.copySource.path}
              </span>
            </KeyValue>
          </Panel>
        )}

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

      {!hideIncludeExtras && (
        <>
          <Checkbox
            checked={includeVideoAndPlayers}
            onChange={onIncludeVideoAndPlayersChange}
            disabled={!!includeExtrasDisabledReason}
            label={t('bootstrapWizard.confirm.includeExtras')}
          />
          {includeExtrasDisabledReason ? (
            <p
              className="text-xs text-ink-muted"
              data-testid="bootstrap-confirm-include-extras-disabled"
            >
              {includeExtrasDisabledReason}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-ink-muted">
              {t('bootstrapWizard.confirm.includeExtrasHint')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
