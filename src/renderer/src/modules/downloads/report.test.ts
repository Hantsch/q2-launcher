import { describe, expect, it } from 'vitest'
import i18next from 'i18next'
import type {
  DownloadDiagnostics,
  DownloadDiagnosticsAssemblyEntry,
  DownloadDiagnosticsPackage,
  DownloadDiagnosticsTarget,
  DownloadFailure,
} from '@shared/modules/downloads'
import type { AppInfo } from '@shared/types/common'
import en from '../../i18n/locales/en.json'
import { buildFailureReport } from './report'

/**
 * Story 075 D5. `t` is a real, isolated i18next instance (not the app's shared singleton) so
 * missing-key behaviour is exactly what production sees, and every call is recorded so the
 * "every label comes from en.json" test can assert on them directly - see AC7's mapped test name.
 */
async function makeT() {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  })

  const calledKeys = new Set<string>()
  const t: typeof instance.t = ((key: string, options?: Record<string, unknown>) => {
    calledKeys.add(key)
    return instance.t(key, options)
  }) as typeof instance.t

  return { t, calledKeys, exists: (key: string) => instance.exists(key) }
}

/**
 * The account-name segment of the stub's paths. `AppInfo`'s own path fields are *not* redacted -
 * they come straight from `app.getPath()`/`electron-log` in main (`src/main/ipc/app.ts`) - so in
 * production `logPath`/`userDataPath` look exactly like this. The stub carries the real shape on
 * purpose: a report that ever started printing one of those fields would then leak an account name,
 * and "does not contain a home-directory segment" below is what catches it.
 */
const ACCOUNT_NAME = 'realaccountname'

const appInfo: AppInfo = {
  appVersion: '1.2.3',
  electronVersion: '30.0.0',
  chromeVersion: '124.0.0',
  nodeVersion: '20.10.0',
  platform: 'win32',
  userDataPath: `C:\\Users\\${ACCOUNT_NAME}\\AppData\\Roaming\\Q2 Launcher`,
  logPath: `C:\\Users\\${ACCOUNT_NAME}\\AppData\\Roaming\\Q2 Launcher\\logs\\main.log`,
  isDev: false,
  isPackaged: true,
  osVersion: '10.0.26200',
}

const packages: DownloadDiagnosticsPackage[] = [
  { id: 'q2pro-1.0', url: 'https://example.test/q2pro.zip', sizeBytes: 4_500_000, verified: true, extracted: true },
  { id: 'demo-data', url: 'https://mirror.test/demo.zip', sizeBytes: 12_000_000, verified: true, extracted: false },
]

const target: DownloadDiagnosticsTarget = {
  targetPath: 'D:\\Games\\Quake II',
  verdict: 'invalid',
  missingChecks: [{ id: 'base-paks', messageKey: 'validation.pak0Missing' }],
}

const diagnostics: DownloadDiagnostics = {
  jobId: 'job-1',
  kind: 'bootstrap',
  startedAt: '2026-09-08T10:00:00.000Z',
  finishedAt: '2026-09-08T10:05:00.000Z',
  errorKey: 'downloads.error.installationNotPlayable',
  packages,
  target,
  logTail: ['[10:04:59] extracting demo-data', '[10:05:00] no usable game data produced'],
}

/**
 * Story 078 D4: assembly entries and per-package `contents`, shaped like they would be after
 * capture in main - relative paths only, already redacted (`redactHome`, story 078 D1/D3) - not
 * raw account paths. AC9's home-directory check below still exercises `appInfo`'s deliberately
 * unredacted stub (see ACCOUNT_NAME above) alongside these, since that is the report's real risk
 * surface, not this data.
 */
const assembly: DownloadDiagnosticsAssemblyEntry[] = [
  { from: 'baseq2\\pak0.pak', to: 'baseq2\\pak0.pak', found: true, sourcePackageId: 'demo-data' },
  { from: 'players\\male\\tris.md2', to: 'players\\male\\tris.md2', found: false },
]

const packagesWithContents: DownloadDiagnosticsPackage[] = [
  {
    id: 'q2pro-1.0',
    url: 'https://example.test/q2pro.zip',
    sizeBytes: 4_500_000,
    verified: true,
    extracted: true,
    contents: ['q2pro.exe', 'q2proded.exe'],
  },
  {
    id: 'demo-data',
    url: 'https://mirror.test/demo.zip',
    sizeBytes: 12_000_000,
    verified: true,
    extracted: true,
    contents: ['Install', 'readme.txt'],
    contentsTruncated: true,
  },
]

function makeFailure(overrides: Partial<DownloadFailure> = {}): DownloadFailure {
  return {
    id: 'failure-1',
    jobId: 'job-1',
    labelKey: 'downloads.job.bootstrap',
    labelParams: { name: 'Q2PRO Demo' },
    error: { key: 'downloads.error.installationNotPlayable' },
    createdAt: Date.now(),
    diagnostics,
    ...overrides,
  }
}

describe('buildFailureReport', () => {
  it('the report carries versions, error key, package table, verdict and log tail', async () => {
    const { t } = await makeT()
    const report = buildFailureReport({ failure: makeFailure(), appInfo, t })

    // Versions
    expect(report).toContain('1.2.3')
    expect(report).toContain('30.0.0')
    expect(report).toContain('124.0.0')
    expect(report).toContain('20.10.0')
    expect(report).toContain('win32')
    expect(report).toContain('10.0.26200')

    // Error key
    expect(report).toContain('downloads.error.installationNotPlayable')

    // Package table - one row per package
    expect(report).toContain('q2pro-1.0')
    expect(report).toContain('https://example.test/q2pro.zip')
    expect(report).toContain('demo-data')
    expect(report).toContain('https://mirror.test/demo.zip')

    // Verdict block
    expect(report).toContain('D:\\Games\\Quake II')
    expect(report).toContain('base-paks')

    // Log tail, fenced
    expect(report).toContain('```')
    expect(report).toContain('extracting demo-data')
    expect(report).toContain('no usable game data produced')
  })

  it('every label in the report comes from en.json', async () => {
    const { t, calledKeys, exists } = await makeT()
    buildFailureReport({ failure: makeFailure(), appInfo, t })

    expect(calledKeys.size).toBeGreaterThan(0)
    for (const key of calledKeys) {
      expect(exists(key), `missing i18n key: ${key}`).toBe(true)
    }
  })

  it('is total for a failure with no diagnostics at all', async () => {
    const { t } = await makeT()
    const failure = makeFailure({ diagnostics: undefined })

    expect(() => buildFailureReport({ failure, appInfo, t })).not.toThrow()
    const report = buildFailureReport({ failure, appInfo, t })
    expect(report).toContain('downloads.error.installationNotPlayable')
    expect(report.length).toBeGreaterThan(0)
  })

  it('is total for diagnostics with no target and an empty package list', async () => {
    const { t } = await makeT()
    const failure = makeFailure({
      diagnostics: { ...diagnostics, target: undefined, packages: [] },
    })

    const report = buildFailureReport({ failure, appInfo, t })
    expect(report).not.toContain(target.targetPath)
    // Table still renders with headers even with zero rows.
    expect(report).toMatch(/\|.*\|\n\|.*---.*\|/)
  })

  it('does not contain a home-directory segment', async () => {
    const { t } = await makeT()
    const report = buildFailureReport({ failure: makeFailure(), appInfo, t })

    // The stub's `logPath`/`userDataPath` are un-redacted, home-directory-shaped paths (see
    // ACCOUNT_NAME above), so this fails the moment the report prints either of them - the builder
    // must either never reference those fields, or only ever a redacted form of them.
    expect(report).not.toContain(ACCOUNT_NAME)
    expect(report).not.toContain(appInfo.logPath)
    expect(report).not.toContain(appInfo.userDataPath)
    expect(report).not.toMatch(/[A-Za-z]:\\Users\\[^\\]+/)
    expect(report).not.toMatch(/\/home\/[^/]+/)
  })

  it('the report carries the assembly table', async () => {
    const { t } = await makeT()
    const failure = makeFailure({ diagnostics: { ...diagnostics, assembly } })
    const report = buildFailureReport({ failure, appInfo, t })

    expect(report).toContain('baseq2\\pak0.pak')
    expect(report).toContain('players\\male\\tris.md2')
    expect(report).toContain('demo-data')
    expect(report).toContain(t('downloads.failures.report.assemblyHeading'))
    expect(report).toContain(t('downloads.failures.report.yes'))
    expect(report).toContain(t('downloads.failures.report.no'))
  })

  it("the report carries each package's extraction listing", async () => {
    const { t } = await makeT()
    const failure = makeFailure({
      diagnostics: { ...diagnostics, packages: packagesWithContents },
    })
    const report = buildFailureReport({ failure, appInfo, t })

    expect(report).toContain(t('downloads.failures.report.extractionHeading'))
    expect(report).toContain('q2pro.exe')
    expect(report).toContain('q2proded.exe')
    expect(report).toContain('Install')
    expect(report).toContain('readme.txt')
    expect(report).toContain(t('downloads.failures.report.extractionTruncated'))
  })

  it('a record without assembly/contents still yields a valid report with those sections absent', async () => {
    const { t } = await makeT()
    const report = buildFailureReport({ failure: makeFailure(), appInfo, t })

    expect(report).not.toContain(t('downloads.failures.report.assemblyHeading'))
    expect(report).not.toContain(t('downloads.failures.report.extractionHeading'))
    expect(report.length).toBeGreaterThan(0)
  })

  it('no home-directory segment in the new sections', async () => {
    const { t } = await makeT()
    const failure = makeFailure({
      diagnostics: { ...diagnostics, assembly, packages: packagesWithContents },
    })
    const report = buildFailureReport({ failure, appInfo, t })

    // `assembly`/`contents` here already look redacted (relative paths, no account name) - the
    // real risk surface is `appInfo`'s deliberately unredacted `C:\Users\<name>\...` stub
    // (ACCOUNT_NAME above), which must still not leak now that these new sections are populated.
    expect(report).not.toContain(ACCOUNT_NAME)
    expect(report).not.toContain(appInfo.logPath)
    expect(report).not.toContain(appInfo.userDataPath)
    expect(report).not.toMatch(/[A-Za-z]:\\Users\\[^\\]+/)
    expect(report).not.toMatch(/\/home\/[^/]+/)
  })
})
