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
 * Story 078 D4 adds two maintainer-only sections after the verdict block: the assembly table
 * (AC7 - what `assembleInstallation` looked for, whether it found it, which package served it)
 * and, per package, its capped extraction listing (AC8). Both are report-only per (User) Q1 -
 * the user-facing card never renders them.
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

  if (diagnostics?.assembly) {
    sections.push(buildAssemblySection(diagnostics.assembly, t))
  }

  const extractionSection = buildExtractionSection(diagnostics?.packages ?? [], t)
  if (extractionSection) {
    sections.push(extractionSection)
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

/**
 * Story 078 D4 (AC7): what `assembleInstallation` looked for, whether it found it, and which
 * package's extraction served it - the maintainer-only counterpart to the (User) Q1 decision that
 * keeps this table out of the user-facing card. Pushed only when `diagnostics.assembly` exists at
 * all (a pre-078 record has no field to check), mirroring `buildVerdictSection`'s
 * presence-gated push - an empty array (the field present but nothing planned) still renders a
 * header-only table, same as `buildPackagesSection` does for zero packages.
 */
function buildAssemblySection(
  assembly: NonNullable<NonNullable<DownloadFailure['diagnostics']>['assembly']>,
  t: TFunction,
): string {
  const header = [
    t('downloads.failures.report.columnFrom'),
    t('downloads.failures.report.columnTo'),
    t('downloads.failures.report.columnFound'),
    t('downloads.failures.report.columnSourcePackage'),
  ]
  const yes = t('downloads.failures.report.yes')
  const no = t('downloads.failures.report.no')

  const rows = assembly.map((entry) => [
    entry.from,
    entry.to,
    entry.found ? yes : no,
    entry.sourcePackageId ?? '',
  ])

  const table = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')

  return [`## ${t('downloads.failures.report.assemblyHeading')}`, '', table].join('\n')
}

/**
 * Story 078 D4 (AC8): per package, its capped top-level extraction listing (`contents`), with an
 * explicit marker when `contentsTruncated` cut it off - "a self-extracting installer nested its
 * payload under a wrapper directory" made visible without a file tree in `state.json`. Returns
 * `undefined` (never pushed) when no package in this run carries a `contents` field at all, so a
 * pre-078 record - or one that failed before any package extracted - gets no empty heading.
 */
function buildExtractionSection(
  packages: NonNullable<DownloadFailure['diagnostics']>['packages'],
  t: TFunction,
): string | undefined {
  const withContents = packages.filter((pkg) => pkg.contents !== undefined)
  if (withContents.length === 0) {
    return undefined
  }

  const blocks = withContents.map((pkg) => {
    const lines = [`### ${pkg.id}`, '', ...(pkg.contents ?? []).map((name) => `- ${name}`)]
    if (pkg.contentsTruncated) {
      lines.push(`- ${t('downloads.failures.report.extractionTruncated')}`)
    }
    return lines.join('\n')
  })

  return [`## ${t('downloads.failures.report.extractionHeading')}`, '', ...blocks].join('\n\n')
}

function buildLogSection(logTail: string[], t: TFunction): string {
  return [`## ${t('downloads.failures.report.logHeading')}`, '', '```', ...logTail, '```'].join(
    '\n',
  )
}
