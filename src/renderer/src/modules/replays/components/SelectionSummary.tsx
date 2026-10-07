import { useTranslation } from 'react-i18next'

/** The detail pane while several demos are selected: what the selection holds. */
export function SelectionSummary(props: { count: number; zipCount: number }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 p-5" data-testid="replays-selection-summary">
      <p className="text-sm text-ink">{t('replays.multi.count', { count: props.count })}</p>
      {props.zipCount > 0 && (
        <p className="text-xs text-ink-muted" data-testid="replays-selection-summary-zip">
          {t('replays.multi.zip', { count: props.zipCount })}
        </p>
      )}
    </div>
  )
}
