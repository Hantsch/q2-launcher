import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react'
import type { Finding, FindingSubject } from '@shared/config/validation'
import { engineLabel } from '@shared/types/engine'
import { cn } from '../../lib/cn'
import { Badge, EmptyState, Panel, SectionLabel, type BadgeTone } from '../../components/ui/primitives'
import type { EngineValidation, ProfileValidation } from './lib/validation-scope'

const LEVEL_TONE: Record<Finding['level'], BadgeTone> = {
  info: 'flame',
  warning: 'warning',
  error: 'danger',
}

const LEVEL_ICON: Record<Finding['level'], typeof CircleX> = {
  info: CircleHelp,
  warning: TriangleAlert,
  error: CircleX,
}

function subjectLabel(subject: FindingSubject, t: (key: string, options?: Record<string, unknown>) => string): string {
  return t(`config.validation.subject.${subject.kind}`, { id: subject.id })
}

/**
 * The Validation tab's content (story 009 D5): one equally-weighted section
 * per distinct engine the profile is actually reachable through, or one of
 * the three explicit "nothing to validate against" states - never a silent
 * pass and never r1q2's numbers substituted for an out-of-scope assignment.
 *
 * Always mounted, never conditional on findings existing (AC 3) - a tab that
 * disappears when there is nothing to validate would look exactly like a
 * silent pass, which is the one thing this whole story exists to prevent.
 *
 * `result` is computed once by `ConfigView` (over the in-progress draft, not
 * necessarily what is saved on disk - story 009 D6's `useProfileDraft`) and
 * passed in rather than recomputed here, so the tab badge and this panel
 * never run `validateProfileForEngines` twice for the same draft. That is
 * also what makes AC 4 (validate unsaved edits) work: `ConfigView` recomputes
 * on every keystroke that reaches the draft, with no IPC round trip in
 * between, and this component just renders whatever it was handed.
 */
export function ValidationPanel({ result }: { result: ProfileValidation }) {
  const { t } = useTranslation()

  if (result.status !== 'ok') {
    return (
      <Panel className="p-6">
        <EmptyState
          icon={<CircleHelp className="size-6" />}
          title={t('config.validation.empty.title')}
          body={
            result.status === 'unassigned'
              ? t('config.validation.empty.unassigned')
              : result.status === 'unresolved'
                ? t('config.validation.empty.unresolved')
                : t('config.validation.empty.noFacts', {
                    engines: result.omitted.map(engineLabel).join(', '),
                  })
          }
        />
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      {result.byEngine.map((entry) => (
        <EngineSection key={entry.engine} entry={entry} />
      ))}
    </div>
  )
}

function EngineSection({ entry }: { entry: EngineValidation }) {
  const { t } = useTranslation()

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>{engineLabel(entry.engine)}</SectionLabel>
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.summary.errors > 0 && (
            <Badge tone="danger">
              {t('config.validation.count.errors', { count: entry.summary.errors })}
            </Badge>
          )}
          {entry.summary.warnings > 0 && (
            <Badge tone="warning">
              {t('config.validation.count.warnings', { count: entry.summary.warnings })}
            </Badge>
          )}
          {entry.summary.errors === 0 && entry.summary.warnings === 0 && (
            <Badge tone="success">{t('config.validation.allGood')}</Badge>
          )}
        </div>
      </div>

      {entry.findings.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-success">
          <CircleCheck className="size-3.5" />
          {t('config.validation.engineEmpty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {entry.findings.map((finding) => (
            <FindingRow key={finding.id} finding={finding} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function FindingRow({ finding }: { finding: Finding }) {
  const { t } = useTranslation()
  const Icon = LEVEL_ICON[finding.level]

  return (
    <li className="flex items-start gap-2.5">
      <Icon
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          finding.level === 'error' && 'text-danger',
          finding.level === 'warning' && 'text-warning',
          finding.level === 'info' && 'text-ink-muted',
        )}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={LEVEL_TONE[finding.level]}>{subjectLabel(finding.subject, t)}</Badge>
        </div>
        <p className="text-xs leading-relaxed text-ink-dim" data-selectable>
          {t(finding.messageKey, finding.params ?? {})}
        </p>
        {finding.fixKey && (
          <p className="text-xs text-ink-muted">{t(finding.fixKey, finding.params ?? {})}</p>
        )}
        {finding.source && <p className="text-[10px] text-ink-faint">{finding.source}</p>}
      </div>
    </li>
  )
}
