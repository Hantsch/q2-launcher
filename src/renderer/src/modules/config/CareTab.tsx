import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleHelp, TriangleAlert } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import type { Installation } from '@shared/types/installation'
import { Badge, Panel, SectionLabel, type BadgeTone } from '../../components/ui/primitives'
import { CareSyncSection } from './CareSyncSection'
import { CareTidyUpSection } from './CareTidyUpSection'
import { CleanupPanel } from './CleanupPanel'
import {
  careSummary,
  type CareCleanupStatus,
  type CareSummary,
  type CareSyncStatus,
  type SectionStatus,
} from './lib/care-summary'
import { analyzeTidyUp } from './lib/tidy-up-findings'
import type { ProfileValidation } from './lib/validation-scope'
import { PreservedLinesPanel } from './PreservedLinesPanel'
import { ValidationPanel } from './ValidationPanel'

/**
 * Story 025 D1: the Care tab replaces the old separate Validation tab and
 * conditional Preserved-lines tab with one section stack - same shape as the
 * Overview tab's own stack of `OverviewKeyboardPanel` + `LayersPanel` in
 * `ConfigView.tsx`. Both sections are the pre-existing panels mounted
 * verbatim: this component owns no validation/preserved-lines logic of its
 * own, it only lays the two out one above the other. The validation report
 * (story 009) keeps rendering exactly as before; `PreservedLinesPanel` is now
 * always mounted rather than only appearing when `profile.unrecognized` is
 * non-empty (its own empty state already covers that case).
 *
 * Story 025 D2 adds `CareSyncSection` as a third section below the first
 * two: the profile's own canonical file plus one row per assigned
 * installation, each showing its live sync state (story 022's
 * `getProfileSyncState`) with a retry action on a failed write. Same rule as
 * the other two sections - it owns its own fetch and logic entirely, this
 * component still only stacks sections, never reaches into any of them.
 *
 * Story 025 D5 adds `CareTidyUpSection` as a fourth section, below `CareSyncSection`:
 * `analyzeTidyUp`'s flat maintenance list, with per-finding preview and apply. Its
 * `onProfileUpdated` is threaded straight through to `ConfigView` unchanged (this
 * component owns no profile-update logic of its own, same as every other section
 * here) - `ConfigView` is the one place that knows how to fold a single updated
 * `ConfigProfile` back into whatever state feeds `profile` everywhere else.
 *
 * Story 025 D7 moves story 010's `CleanupPanel` (mod-copies cleanup) here as a
 * fifth section, off the config module's list screen where it used to sit
 * independent of any profile. `installations` and `assignedInstallationIds`
 * are passed straight through from `ConfigView` unchanged - this component
 * still only stacks sections, it does not compute the scope itself.
 *
 * Story 025 D8 adds a Care-level summary above every section (AC 7): whether
 * each one is clean, has n items, or (cleanup only) has not been checked yet,
 * plus one overall "all clear" line that only fires once every section is
 * clean AND the cleanup has actually been scanned (decision 17 - cleanup is
 * the one section that needs a user action before it can say anything).
 *
 * The tidy-up findings feeding the summary are computed here directly
 * (`analyzeTidyUp` is pure and cheap - same idiom `CareTidyUpSection` already
 * uses for its own copy), rather than lifted through a prop: this component
 * still owns no tidy-up logic of its own, it just also needs the count.
 *
 * Sync and cleanup are different: both keep their live state entirely inside
 * their own section (an IPC fetch on mount for sync, a scan the user
 * triggers for cleanup), so there is nothing to read here without lifting it.
 * Rather than add a second fetch or duplicate either section's state, both
 * sections gained an optional callback prop that reports their result up
 * here the moment they already have it - `onStatusChange` on both
 * `CareSyncSection` and `CleanupPanel`. Decision recorded here per the
 * deliverable's own instructions: sync is automatic (fires on mount, no user
 * action, same "always answerable" bucket as the report and tidy-up), so it
 * is folded into the summary the same way as those two.
 *
 * Story 025 review finding F3: the summary panel must never disappear just
 * because sync has not resolved yet or its fetch failed - that reintroduces
 * the exact "is it clean or unchecked" ambiguity AC 8 forbids, just triggered
 * by a transport error instead of an unscanned cleanup. So the summary is
 * always computed and rendered (validation and tidy-up are synchronous;
 * cleanup already answers `notChecked` before its first scan); `syncStatus`
 * starts at `{ kind: 'loading' }` and `CareSyncSection` reports `'loaded'` or
 * `'error'` the moment its own fetch settles, with `careSummary` reading
 * anything other than `'loaded'` as `notChecked` for that section - never a
 * guessed "clean".
 */
export function CareTab({
  profile,
  validation,
  onProfileUpdated,
  installations,
  assignedInstallationIds,
}: {
  profile: ConfigProfile
  validation: ProfileValidation
  onProfileUpdated: (profile: ConfigProfile) => void
  installations: Installation[]
  assignedInstallationIds: string[]
}) {
  const tidyUpFindings = useMemo(() => analyzeTidyUp(profile), [profile])

  const [syncStatus, setSyncStatus] = useState<CareSyncStatus>({ kind: 'loading' })
  const [cleanupStatus, setCleanupStatus] = useState<CareCleanupStatus>({
    scanned: false,
    itemCount: 0,
  })

  const summary = careSummary({
    validation,
    tidyUpFindings,
    sync: syncStatus,
    cleanup: cleanupStatus,
  })

  return (
    <div className="space-y-6">
      <CareSummaryPanel summary={summary} />
      <ValidationPanel result={validation} />
      <PreservedLinesPanel profile={profile} />
      <CareSyncSection profile={profile} onStatusChange={setSyncStatus} />
      <CareTidyUpSection profile={profile} onProfileUpdated={onProfileUpdated} />
      <CleanupPanel
        installations={installations}
        assignedInstallationIds={assignedInstallationIds}
        onStatusChange={setCleanupStatus}
      />
    </div>
  )
}

const SECTION_ORDER: readonly ['report', 'sync', 'tidyUp', 'cleanup'] = [
  'report',
  'sync',
  'tidyUp',
  'cleanup',
]

/**
 * The AC 7 summary itself: one status line per section, then the overall
 * headline. `allClear`'s text is deliberately a different sentence from
 * `notChecked`'s, never just the absence of an "items" badge - AC 7's whole
 * point is that "nothing to report" must never look identical to "not
 * checked yet".
 */
function CareSummaryPanel({ summary }: { summary: CareSummary }) {
  const { t } = useTranslation()

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>{t('config.care.summary.label')}</SectionLabel>
        {summary.allClear ? (
          <Badge tone="success" className="gap-1">
            <CircleCheck className="size-3" />
            {t('config.care.summary.overall.allClear')}
          </Badge>
        ) : (
          <Badge tone="warning" className="gap-1">
            <TriangleAlert className="size-3" />
            {t('config.care.summary.overall.notAllClear')}
          </Badge>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {SECTION_ORDER.map((section) => (
          <li key={section}>
            <SectionStatusBadge section={section} status={summary[section]} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function SectionStatusBadge({
  section,
  status,
}: {
  section: 'report' | 'sync' | 'tidyUp' | 'cleanup'
  status: SectionStatus
}) {
  const { t } = useTranslation()

  const tone: BadgeTone =
    status.kind === 'clean' ? 'success' : status.kind === 'notChecked' ? 'neutral' : 'warning'
  const Icon = status.kind === 'clean' ? CircleCheck : status.kind === 'notChecked' ? CircleHelp : TriangleAlert
  const statusLabel =
    status.kind === 'clean'
      ? t('config.care.summary.status.clean')
      : status.kind === 'notChecked'
        ? t('config.care.summary.status.notChecked')
        : t('config.care.summary.status.items', { count: status.count })

  return (
    <Badge tone={tone} className="gap-1">
      <Icon className="size-3" />
      {t(`config.care.summary.section.${section}`)}: {statusLabel}
    </Badge>
  )
}
