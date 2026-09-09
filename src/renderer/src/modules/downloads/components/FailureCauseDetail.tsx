import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DownloadDiagnostics, DownloadDiagnosticsPackage } from '@shared/modules/downloads'
import { statusTone } from '../../../lib/status'

/**
 * Story 078 D5 (AC1/AC2/AC3/AC6): the shared, collapsed "what went wrong" detail for a failed
 * download - mounted by both the Downloads tab's `FailureLogEntry` (D6) and the bootstrap
 * wizard's `RunningStep` (D7), so a user reads the same cause in either place (Decisions
 * (Sprint), Q2). A native `<details>`/`<summary>` mirroring `DownloadsView.tsx`'s existing
 * dismissed-failures disclosure (lines 203-220) - closed by default satisfies AC3 without JS
 * state, and the body genuinely leaves the accessible tree until opened (browser behaviour, not
 * something this component has to implement).
 *
 * Renders `null` outright when there is nothing to show (AC6) - a failure entry written before
 * this story, or from the single-package pipeline, carries no `diagnostics` at all.
 *
 * Deliberately does not render `diagnostics.assembly` or any package's `contents` - (User) Q1:
 * those two records are for the copied report only (`report.ts`), not the user-facing card.
 */
export interface FailureCauseDetailProps {
  diagnostics: DownloadDiagnostics | undefined
  /** Optional slot rendered inside the opened body, below the cause content - the reveal-log
   * action lands here (D6/D7), demoting it out of the card's always-visible cluster (AC5). */
  footer?: ReactNode
}

/**
 * The furthest pipeline step a package's booleans show it reaching, in the order the bootstrap
 * pipeline actually runs them: fetched (implicit - the package is in the list at all) → verified
 * → extracted → contributed. Stops at the first step that is not true, so a package that
 * verified and extracted but never contributed reads as having reached "extracted" (AC1's
 * "every package downloaded, nothing reached the installation" case) rather than being credited
 * with a step it never actually cleared.
 *
 * `contributed` carries a third state review finding M3 (078) exists to distinguish:
 * `diagnostics.ts`'s `recordAssembly` sets it to an explicit `true`/`false` for every package on
 * every package on every call, but only ever calls it when assembly actually ran - so `undefined`
 * means "assembly never ran for this job" (e.g. a run that failed downloading a *later* package,
 * before this one's extraction was ever handed to assembly), while `false` means "assembly ran and
 * this package's extraction served nothing". The two read very differently: the `extracted` copy
 * below states outright that the package "did not contribute", which is only true of the `false`
 * case - claiming it for `undefined` would blame assembly for a package it never even looked at.
 */
function reachedStep(
  pkg: DownloadDiagnosticsPackage,
): 'fetched' | 'verified' | 'extractedNoAssembly' | 'extracted' | 'contributed' {
  if (!pkg.verified) return 'fetched'
  if (!pkg.extracted) return 'verified'
  if (pkg.contributed === undefined) return 'extractedNoAssembly'
  if (!pkg.contributed) return 'extracted'
  return 'contributed'
}

export function FailureCauseDetail({ diagnostics, footer }: FailureCauseDetailProps) {
  const { t } = useTranslation()

  if (!diagnostics) {
    return null
  }

  return (
    <details className="group rounded-md border border-line">
      <summary className="stencil cursor-pointer list-none px-3 py-2 select-none">
        {t('downloads.failures.detail.summary')}
      </summary>
      <div className="space-y-3 p-3 pt-0">
        {diagnostics.packages.length > 0 && (
          <ul className="space-y-1">
            {diagnostics.packages.map((pkg) => (
              <li key={pkg.id} className="text-xs leading-relaxed text-ink-dim" data-selectable>
                {t(`downloads.failures.detail.step.${reachedStep(pkg)}`, { id: pkg.id })}
              </li>
            ))}
          </ul>
        )}

        {diagnostics.target && (
          <div className="space-y-1">
            <p className="text-xs text-ink" data-selectable>
              <span className="font-medium">{t('downloads.failures.detail.verdictHeading')}:</span>{' '}
              {t(statusTone(diagnostics.target.verdict).labelKey)}
            </p>
            {diagnostics.target.missingChecks.length > 0 && (
              <ul className="space-y-1">
                {diagnostics.target.missingChecks.map((check) => (
                  <li
                    key={check.id}
                    className="text-xs leading-relaxed text-ink-dim"
                    data-selectable
                  >
                    {t(check.messageKey)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {footer && <div className="flex justify-end pt-1">{footer}</div>}
      </div>
    </details>
  )
}
