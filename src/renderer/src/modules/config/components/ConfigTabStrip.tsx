import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs } from '../../../components/ui/Tabs'
import { Badge } from '../../../components/ui/primitives'
import { dedupedFindingCounts, type CareSyncStatus } from '../lib/care-summary'
import { useProfileDraftContext } from '../lib/ProfileDraftProvider'
import { analyzeTidyUp } from '../lib/tidy-up-findings'
import { useDraftValidation } from '../lib/useDraftValidation'
import { UnsavedTabBadge } from './UnsavedIndicator'

export type DetailTab =
  'overview' | 'settings' | 'controls' | 'aliases' | 'raw' | 'care' | 'unsaved'

/**
 * The Care tab's badge counts validation findings, tidy-up findings and non-`inSync` Files rows
 * together, de-duplicated by finding id (`dedupedFindingCounts`) - the alias-wiring rules feed both
 * lists, so a naive sum would double-count them. Tidy-up and drift answer against the *saved*
 * profile (that is what `tidyUp.apply` mutates), and `profile.dirty` tells a canonical `outOfSync`
 * row it is merely unsaved edits.
 */
function CareTabBadge({ driftStatus }: { driftStatus: CareSyncStatus }) {
  const { profile } = useProfileDraftContext()
  const validation = useDraftValidation()
  const tidyUpFindings = useMemo(() => analyzeTidyUp(profile), [profile])
  const driftRows = useMemo(
    () => (driftStatus.kind === 'loaded' ? driftStatus.rows : []),
    [driftStatus],
  )
  const counts = useMemo(
    () => dedupedFindingCounts(validation, tidyUpFindings, driftRows, profile.dirty),
    [validation, tidyUpFindings, driftRows, profile.dirty],
  )
  // Errors take priority over warnings for the one badge a tab button can show; the panel lists both.
  if (counts.errors > 0) return <Badge tone="danger">{String(counts.errors)}</Badge>
  if (counts.warnings > 0) return <Badge tone="warning">{String(counts.warnings)}</Badge>
  return null
}

/**
 * One strip, one padding value, on all seven tabs: a strip that changes height or position when the
 * raw tab is picked has moved. The `Tabs` button padding (`py-1`) and the missing bottom padding
 * (buttons sit directly on the bottom rule) are what fit the shared header inside the 30-visible-
 * editor-line budget, measured by `scripts/flows/config-header-geometry.mjs`.
 */
export function ConfigTabStrip({
  activeTab,
  onChange,
  hasUnsaved,
  driftStatus,
}: {
  activeTab: DetailTab
  onChange: (tab: DetailTab) => void
  /** The Unsaved tab exists only while something is unsaved (structured or raw draft). */
  hasUnsaved: boolean
  driftStatus: CareSyncStatus
}) {
  const { t } = useTranslation()
  const { profile } = useProfileDraftContext()

  const items: { id: DetailTab; label: string; badge?: ReactNode }[] = [
    { id: 'overview', label: t('config.tabs.overview') },
    { id: 'settings', label: t('config.tabs.settings') },
    { id: 'controls', label: t('config.tabs.controls') },
    { id: 'aliases', label: t('config.tabs.aliases') },
    { id: 'raw', label: t('config.tabs.raw') },
    // Always present (never conditional on findings existing) - see `ValidationPanel`.
    {
      id: 'care',
      label: t('config.tabs.care'),
      badge: <CareTabBadge driftStatus={driftStatus} />,
    },
    // Last, right of Care: the dirty states are transient, so unlike Care a permanent tab would be
    // empty most of the time.
    ...(hasUnsaved
      ? [
          {
            id: 'unsaved' as const,
            label: t('config.tabs.unsaved'),
            badge: <UnsavedTabBadge profile={profile} />,
          },
        ]
      : []),
  ]

  return (
    <Tabs
      idBase="config"
      ariaLabel={t('config.tabs.label')}
      testId="config-tab-strip"
      className="border-b border-line"
      value={activeTab}
      onChange={(id) => onChange(id as DetailTab)}
      items={items.map((item) => ({ ...item, testId: `config-tab-${item.id}` }))}
    />
  )
}
