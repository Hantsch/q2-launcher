import type { TFunction } from 'i18next'
import type { DownloadFailure } from '@shared/modules/downloads'
import type { AppInfo } from '@shared/types/common'
import { formatBytes } from '../../lib/format'
import { statusTone } from '../../lib/status'

/**
 * Story 075 D5: turns a failed download's diagnostics into a ready-to-paste Markdown report
 * (AC3) - app/Electron/OS versions, the error key, the per-package table (AC1), the AC2 verdict
 * block and the job's own log tail. Pure: no IPC, no side effects, `t` passed in so this is
 * testable without a real i18n instance (Decisions (Refine), Plan step 5).
 *
 * Every heading/column label goes through `t()` (AC7) - never a literal English string in this
 * file. The only content that is *not* translated is diagnostic data itself (package ids, URLs,
 * byte counts, the raw `errorKey`, log lines): the same category as a stack trace, already
 * redacted at capture time in main (`redactHome`, story 075 D2) - this builder must not undo
 * that, so it never reformats or re-derives a path, it only prints what it was given.
 *
 * Total by construction: `diagnostics` itself is optional on `DownloadFailure`, `target` is
 * optional on `DownloadDiagnostics`, and `packages`/`missingChecks`/`logTail` may be empty
 * arrays - every branch below has a fallback that still produces valid Markdown.
 */
export interface BuildFailureReportInput {
  failure: DownloadFailure
  appInfo: AppInfo
  t: TFunction
}

export function buildFailureReport({ failure, appInfo, t }: BuildFailureReportInput): string {
  const diagnostics = failure.diagnostics
  const sections: string[] = []

  sections.push(buildVersionsSection(appInfo, t))
  sections.push(buildErrorSection(diagnostics?.errorKey ?? failure.error.key, t))
  sections.push(buildPackagesSection(diagnostics?.packages ?? [], t))

  if (diagnostics?.target) {
    sections.push(buildVerdictSection(diagnostics.target, t))
  }

  sections.push(buildLogSection(diagnostics?.logTail ?? [], t))

  return sections.join('\n\n') + '\n'
}

function buildVersionsSection(appInfo: AppInfo, t: TFunction): string {
  const lines = [
    `## ${t('downloads.failures.report.versionsHeading')}`,
    '',
    `- ${t('downloads.failures.report.appVersion')}: ${appInfo.appVersion}`,
    `- ${t('downloads.failures.report.electronVersion')}: ${appInfo.electronVersion}`,
    `- ${t('downloads.failures.report.chromeVersion')}: ${appInfo.chromeVersion}`,
    `- ${t('downloads.failures.report.nodeVersion')}: ${appInfo.nodeVersion}`,
    `- ${t('downloads.failures.report.platform')}: ${appInfo.platform}`,
    `- ${t('downloads.failures.report.osVersion')}: ${appInfo.osVersion}`,
  ]
  return lines.join('\n')
}

function buildErrorSection(errorKey: string, t: TFunction): string {
  return [`## ${t('downloads.failures.report.errorHeading')}`, '', errorKey].join('\n')
}

function buildPackagesSection(
  packages: NonNullable<DownloadFailure['diagnostics']>['packages'],
  t: TFunction,
): string {
  const header = [
    t('downloads.failures.report.columnPackage'),
    t('downloads.failures.report.columnUrl'),
    t('downloads.failures.report.columnSize'),
    t('downloads.failures.report.columnVerified'),
    t('downloads.failures.report.columnExtracted'),
  ]
  const yes = t('downloads.failures.report.yes')
  const no = t('downloads.failures.report.no')

  const rows = packages.map((pkg) => [
    pkg.id,
    pkg.url,
    formatBytes(pkg.sizeBytes),
    pkg.verified ? yes : no,
    pkg.extracted ? yes : no,
  ])

  const table = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')

  return [`## ${t('downloads.failures.report.packagesHeading')}`, '', table].join('\n')
}

function buildVerdictSection(
  target: NonNullable<NonNullable<DownloadFailure['diagnostics']>['target']>,
  t: TFunction,
): string {
  const verdictLabel = t(statusTone(target.verdict).labelKey)
  const missingChecks =
    target.missingChecks.length > 0
      ? target.missingChecks.map((check) => `- ${check.id}: ${t(check.messageKey)}`).join('\n')
      : `- ${t('downloads.failures.report.noMissingChecks')}`

  const lines = [
    `## ${t('downloads.failures.report.verdictHeading')}`,
    '',
    `- ${t('downloads.failures.report.targetPath')}: ${target.targetPath}`,
    `- ${t('downloads.failures.report.verdictLabel')}: ${verdictLabel}`,
    '',
    `### ${t('downloads.failures.report.missingChecksHeading')}`,
    '',
    missingChecks,
  ]
  return lines.join('\n')
}

function buildLogSection(logTail: string[], t: TFunction): string {
  return [`## ${t('downloads.failures.report.logHeading')}`, '', '```', ...logTail, '```'].join(
    '\n',
  )
}
