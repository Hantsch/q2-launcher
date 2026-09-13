// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  BootstrapEngineOption,
  BootstrapSummary,
  BootstrapTargetVerdict,
  DetectedRetailSource,
  DownloadFailure,
  GameDataSourceVerdict,
} from '@shared/modules/downloads'
import type { Job } from '@shared/types'
import { initI18n } from '../../../i18n'
import { useLauncher } from '../../../store/useLauncher'
import { BootstrapWizard } from './BootstrapWizard'

/**
 * Story 078 D7 (AC4): `BootstrapWizard` fetches `getDownloadFailures()` once the running job
 * turns `failed` and matches on `jobId`, then hands the match to `RunningStep`
 * (`RunningStep.test.tsx` covers the presentational side of mounting `FailureCauseDetail`).
 *
 * The wizard has to be driven through its own steps to reach `running` - there is no shortcut
 * prop - so this mirrors `FailureLogEntry.test.tsx`/`DownloadsView.test.tsx`'s conventions for
 * stubbing `./client` and the `q2` bridge rather than inventing a new harness.
 */

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(),
    on: vi.fn(() => () => {}),
  }
})

const invokeMock = vi.fn(async (...args: [string, ...unknown[]]) => {
  if (args[0] === 'installations:pickFolder') return 'D:\\Games\\Quake II'
  return { ok: true }
})

vi.mock('../../../lib/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, ...unknown[]])),
}))

const engineOptions: BootstrapEngineOption[] = [
  { engine: 'q2pro', packageId: 'engine-q2pro', version: '1.0.0', sizeBytes: 1_000_000 },
]

/** Story 080 D2: both bootstrap-supported engines pinned, for the engine-selection tests below. */
const twoEngineOptions: BootstrapEngineOption[] = [
  { engine: 'q2pro', packageId: 'engine-q2pro', version: '1.0.0', sizeBytes: 1_000_000 },
  { engine: 'r1q2', packageId: 'engine-r1q2', version: 'b8012-msvs2022', sizeBytes: 751_580 },
]

const verdict: BootstrapTargetVerdict = {
  targetPath: 'D:\\Games\\Quake II',
  blocked: false,
  programFiles: false,
  notWritable: false,
  entries: [],
  alreadyInstalled: false,
}

const summary: BootstrapSummary = {
  targetPath: 'D:\\Games\\Quake II',
  engine: 'q2pro',
  totalSizeBytes: 3_000_000,
  packages: [{ id: 'demo-data', role: 'demo', version: '1.0', sizeBytes: 3_000_000 }],
  includeVideoAndPlayers: false,
  // Story 088 D4: every summary now states its data source; [[074]]'s wizard means this one.
  dataSource: 'free-download',
}

const getDownloadFailures = vi.fn(async (): Promise<{ ok: true; value: DownloadFailure[] }> => ({
  ok: true,
  value: [],
}))

const getBootstrapEngineOptions = vi.fn(async () => ({ ok: true, value: engineOptions }))
const startBootstrapInstall = vi.fn(async () => ({
  ok: true,
  value: { jobId: 'job-1', installationId: 'inst-1' },
}))
const getBootstrapSummary = vi.fn(async () => ({ ok: true, value: summary }))
// Story 088 D5: no detected sources by default - the existing (pre-088) flows never see the
// copy choice at all, matching AC1's "absent when none is found".
const getDetectedRetailSources = vi.fn(
  async (): Promise<{ ok: true; value: DetectedRetailSource[] }> => ({ ok: true, value: [] }),
)

// Story 089 D4: defaults to a `'retail'` verdict, so a test that only cares about reaching the
// existing-folder choice does not also have to stub this - see the dedicated describe block below
// for cases that override it.
const getGameDataSourceVerdict = vi.fn(
  async (): Promise<{ ok: true; value: GameDataSourceVerdict }> => ({
    ok: true,
    value: {
      rootPath: 'E:\\Owned\\Quake II',
      kind: 'retail',
      paks: [
        { name: 'pak0.pak', sizeBytes: 16_575_982, retail: true },
        { name: 'pak1.pak', sizeBytes: 29_257_930, retail: true },
      ],
    },
  }),
)

vi.mock('../client', () => ({
  getBootstrapEngineOptions: (...args: unknown[]) =>
    getBootstrapEngineOptions(...(args as [])),
  getBootstrapTargetVerdict: vi.fn(async () => ({ ok: true, value: verdict })),
  getBootstrapSummary: (...args: unknown[]) => getBootstrapSummary(...(args as [])),
  startBootstrapInstall: (...args: unknown[]) => startBootstrapInstall(...(args as [])),
  getDownloadFailures: (...args: unknown[]) => getDownloadFailures(...(args as [])),
  getDetectedRetailSources: (...args: unknown[]) => getDetectedRetailSources(...(args as [])),
  getGameDataSourceVerdict: (...args: unknown[]) => getGameDataSourceVerdict(...(args as [])),
}))

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    moduleId: 'downloads',
    kind: 'bootstrap-install',
    labelKey: 'downloads.job.bootstrap',
    status: 'running',
    progress: { ratio: 0.5, bytesDone: 500_000, bytesTotal: 1_000_000 },
    cancellable: false,
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

const diagnosticsFailure: DownloadFailure = {
  id: 'failure-1',
  jobId: 'job-1',
  labelKey: 'downloads.job.bootstrap',
  error: { key: 'downloads.error.installationNotPlayable' },
  createdAt: Date.now(),
  diagnostics: {
    jobId: 'job-1',
    kind: 'bootstrap',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    errorKey: 'downloads.error.installationNotPlayable',
    packages: [
      {
        id: 'demo-data',
        url: 'https://mirror.test/demo.zip',
        sizeBytes: 2_000_000,
        verified: true,
        extracted: true,
        contributed: false,
      },
    ],
    logTail: [],
  },
}

/** Drives the wizard from `engine` through `confirm` and starts the job, landing on `running`. */
async function runToRunningStep(): Promise<void> {
  render(createElement(BootstrapWizard))

  await screen.findByTestId('bootstrap-engine-q2pro')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await screen.findByTestId('bootstrap-gamedata-choice-free-download')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await screen.findByTestId('bootstrap-target-path-input')
  fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
  await waitFor(() =>
    expect(
      (screen.getByTestId('bootstrap-target-path-input').querySelector('input') as HTMLInputElement)
        .value,
    ).toBe('D:\\Games\\Quake II'),
  )
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await screen.findByTestId('bootstrap-confirm-total-size')
  await waitFor(() =>
    expect((screen.getByTestId('bootstrap-confirm-start') as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  fireEvent.click(screen.getByTestId('bootstrap-confirm-start'))

  await screen.findByTestId('bootstrap-running-step')
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useLauncher.setState({ jobs: [] })
})

describe('BootstrapWizard failure fetch (story 078 D7, AC4)', () => {
  it('a running job triggers no fetch of getDownloadFailures at all', async () => {
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    expect(screen.getByTestId('bootstrap-running-step').dataset.status).toBe('running')
    expect(getDownloadFailures).not.toHaveBeenCalled()
  })

  it('a succeeded job triggers no fetch of getDownloadFailures at all', async () => {
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    act(() => {
      useLauncher.setState({ jobs: [makeJob({ status: 'succeeded', progress: { ratio: 1, bytesDone: 1, bytesTotal: 1 } })] })
    })

    await waitFor(() =>
      expect(screen.getByTestId('bootstrap-running-step').dataset.status).toBe('succeeded'),
    )
    expect(getDownloadFailures).not.toHaveBeenCalled()
  })

  it('a failed job fetches once, matches by jobId, and RunningStep shows the same cause detail', async () => {
    getDownloadFailures.mockResolvedValueOnce({ ok: true, value: [diagnosticsFailure] })
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    act(() => {
      useLauncher.setState({
        jobs: [
          makeJob({
            status: 'failed',
            error: { key: 'downloads.error.installationNotPlayable' },
          }),
        ],
      })
    })

    await waitFor(() => expect(getDownloadFailures).toHaveBeenCalledTimes(1))

    const details = await waitFor(() => document.querySelector('details') as HTMLDetailsElement)
    expect(details).toBeTruthy()
    expect(details.hasAttribute('open')).toBe(false)
    details.open = true
    expect(
      screen.getByText(
        'demo-data: downloaded, verified and extracted, but did not contribute to the installation',
      ),
    ).toBeTruthy()

    // Further `jobs:changed` ticks while the job stays `failed` (a fresh `Job` object each time,
    // same id/status) must not refetch - the fetch is keyed on the job id, not on effect deps
    // alone re-running.
    act(() => {
      useLauncher.setState({
        jobs: [
          makeJob({
            status: 'failed',
            error: { key: 'downloads.error.installationNotPlayable' },
            progress: { ratio: 1, bytesDone: 2, bytesTotal: 2 },
          }),
        ],
      })
    })

    await waitFor(() =>
      expect(screen.getByTestId('bootstrap-running-step').dataset.status).toBe('failed'),
    )
    expect(getDownloadFailures).toHaveBeenCalledTimes(1)
  })

  it('a failed job with no matching failure entry keeps just the single error line', async () => {
    getDownloadFailures.mockResolvedValueOnce({ ok: true, value: [] })
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    act(() => {
      useLauncher.setState({
        jobs: [
          makeJob({
            status: 'failed',
            error: { key: 'downloads.error.installationNotPlayable' },
          }),
        ],
      })
    })

    await waitFor(() => expect(getDownloadFailures).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByText('The files were downloaded, but the result was not a usable Quake II installation.'),
      ).toBeTruthy(),
    )
    expect(document.querySelector('details')).toBeNull()
  })
})

/**
 * Story 080 D2: `EngineStep` now renders every pinned option as its own selectable row, and
 * `BootstrapWizard` defaults the choice to the first option (so the existing single-Q2PRO UX
 * still needs zero extra clicks) while a user's explicit pick on a later render is never
 * overwritten by that default effect.
 */
describe('BootstrapWizard engine selection (story 080 D2, AC1)', () => {
  it('defaults to the single pinned option and can proceed with zero clicks', async () => {
    getBootstrapEngineOptions.mockResolvedValueOnce({ ok: true, value: engineOptions })

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it('clicking the second row changes the selection before the job is started', async () => {
    getBootstrapEngineOptions.mockResolvedValueOnce({ ok: true, value: twoEngineOptions })

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    await screen.findByTestId('bootstrap-engine-r1q2')
    // Defaulted to the first option - proceeding is already possible with zero clicks.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    fireEvent.click(screen.getByTestId('bootstrap-engine-r1q2'))
    expect(screen.getByTestId('bootstrap-engine-r1q2').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('bootstrap-engine-q2pro').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByTestId('bootstrap-gamedata-choice-free-download')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-target-path-input')
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() =>
      expect(
        (screen.getByTestId('bootstrap-target-path-input').querySelector('input') as HTMLInputElement)
          .value,
      ).toBe('D:\\Games\\Quake II'),
    )
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-confirm-total-size')
    await waitFor(() =>
      expect((screen.getByTestId('bootstrap-confirm-start') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByTestId('bootstrap-confirm-start'))

    await waitFor(() =>
      expect(startBootstrapInstall).toHaveBeenCalledWith(
        expect.objectContaining({ engine: 'r1q2' }),
      ),
    )
  })
})

/**
 * Story 088 D5: the wizard's new game-data step - AC1 (copy option absent when nothing was
 * detected), AC2 (multi-source picker showing store + path), AC3 (an unverified entry stays
 * listed but not selectable, with its reason), the toggle-availability rule (disabled with a
 * reason when the chosen source has neither `baseq2/video` nor `baseq2/players`), and AC5 (the
 * confirm step naming the copy source, the engine-only download and the target).
 */
describe('BootstrapWizard game-data step (story 088 D5)', () => {
  const verifiedSource: DetectedRetailSource = {
    source: 'steam',
    rootPath: 'C:\\Steam\\Quake II',
    inspection: {
      rootPath: 'C:\\Steam\\Quake II',
      pak0: { exists: true, sizeBytes: 16_575_982, matchesRetailSize: true },
      pak1: { exists: true, sizeBytes: 29_257_930, matchesRetailSize: true },
      pak2: { exists: false, sizeBytes: null, matchesRetailSize: false },
      verified: true,
      hasVideo: false,
      hasPlayers: false,
    },
  }

  const unverifiedSource: DetectedRetailSource = {
    source: 'gog',
    rootPath: 'D:\\GOG\\Quake II',
    inspection: {
      rootPath: 'D:\\GOG\\Quake II',
      pak0: { exists: true, sizeBytes: 999, matchesRetailSize: false },
      pak1: { exists: true, sizeBytes: 29_257_930, matchesRetailSize: true },
      pak2: { exists: false, sizeBytes: null, matchesRetailSize: false },
      verified: false,
      unverifiedReason: 'bootstrap.retailSource.pak0SizeMismatch',
      hasVideo: false,
      hasPlayers: false,
    },
  }

  it('offers only the free-download choice when no source was detected (AC1)', async () => {
    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-free-download')
    expect(screen.queryByTestId('bootstrap-gamedata-choice-store-copy')).toBeNull()
  })

  it('Next stays disabled on the game-data step until detected sources resolve, even for the free-download default (review F4)', async () => {
    // Before the fix, `canProceed.gameData` was `true` for the default `'free-download'` choice
    // regardless of `detectedSources` - a fast user could click Next before
    // `getDetectedRetailSources()` ever resolved, skipping straight past a copy option they may
    // never have seen. Held open here with a deferred promise so the loading window is observable.
    let resolveSources: (value: { ok: true; value: DetectedRetailSource[] }) => void = () => {}
    getDetectedRetailSources.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSources = resolve
      }),
    )

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    // Still on the game-data step (its loading message, per `GameDataStep`'s own
    // `sources === null` branch) - and Next is disabled for exactly that window.
    await screen.findByText('Checking for installations you already own…')
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

    act(() => resolveSources({ ok: true, value: [] }))

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it('renders a picker with store + path for each detected source, and keeps an unverified one listed but unselectable, showing its reason (AC2/AC3)', async () => {
    getDetectedRetailSources.mockResolvedValueOnce({
      ok: true,
      value: [verifiedSource, unverifiedSource],
    })

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-store-copy')
    fireEvent.click(screen.getByTestId('bootstrap-gamedata-choice-store-copy'))

    const verifiedRow = await screen.findByTestId('bootstrap-gamedata-source-0')
    expect(verifiedRow.textContent).toContain('Steam')
    expect(verifiedRow.textContent).toContain('C:\\Steam\\Quake II')
    expect((verifiedRow as HTMLButtonElement).disabled).toBe(false)
    // Defaults to the first verified source - Next is already enabled with zero extra clicks.
    expect(verifiedRow.getAttribute('aria-pressed')).toBe('true')

    const unverifiedRow = screen.getByTestId('bootstrap-gamedata-source-1')
    expect(unverifiedRow.textContent).toContain('GOG')
    expect(unverifiedRow.textContent).toContain('D:\\GOG\\Quake II')
    expect((unverifiedRow as HTMLButtonElement).disabled).toBe(true)

    // Story 088 fix cycle (review F3): the actual mismatched size is interpolated in, so the first
    // affected user report already carries the number a later story needs.
    expect(screen.getByTestId('bootstrap-gamedata-source-1-unverified').textContent).toBe(
      'pak0.pak in this installation does not match the known retail size (found 999 B), so it could not be verified as retail.',
    )

    // Clicking the disabled row must not change the selection.
    fireEvent.click(unverifiedRow)
    expect(screen.getByTestId('bootstrap-gamedata-source-0').getAttribute('aria-pressed')).toBe('true')

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it('disables the video/players toggle with a reason when the chosen source has neither directory, and the confirm step names the copy source, the engine-only download and the target (toggle rule, AC5)', async () => {
    getDetectedRetailSources.mockResolvedValueOnce({ ok: true, value: [verifiedSource] })
    getBootstrapSummary.mockResolvedValueOnce({
      ok: true,
      value: {
        targetPath: 'D:\\Games\\Quake II',
        engine: 'q2pro',
        totalSizeBytes: 1_000_000,
        packages: [{ id: 'engine-q2pro', role: 'engine', version: '1.0.0', sizeBytes: 1_000_000 }],
        includeVideoAndPlayers: false,
        dataSource: 'store-copy',
        copySource: { path: 'C:\\Steam\\Quake II', store: 'steam' },
      } satisfies BootstrapSummary,
    })

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-store-copy')
    fireEvent.click(screen.getByTestId('bootstrap-gamedata-choice-store-copy'))
    await screen.findByTestId('bootstrap-gamedata-source-0')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-target-path-input')
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-confirm-total-size')

    expect(screen.getByTestId('bootstrap-confirm-include-extras-disabled').textContent).toBe(
      'This installation has no videos or player models to copy.',
    )
    const copySource = screen.getByTestId('bootstrap-confirm-copy-source')
    expect(copySource.textContent).toContain('Steam')
    expect(copySource.textContent).toContain('C:\\Steam\\Quake II')
    expect(screen.getByTestId('bootstrap-confirm-total-size').textContent).toBeTruthy()
    expect(screen.getByTestId('bootstrap-confirm-target-path').textContent).toBe(
      'D:\\Games\\Quake II',
    )

    await waitFor(() =>
      expect(getBootstrapSummary).toHaveBeenCalledWith(
        expect.objectContaining({ dataSource: 'store-copy', copySourcePath: 'C:\\Steam\\Quake II' }),
      ),
    )
  })
})

/**
 * Story 089 D4: the wizard's third game-data choice - AC1 (always offered, even with zero
 * detected sources), AC2 (the verdict gates Next before the user can proceed), AC4 (a `'demo'`
 * verdict still lets the user continue) and AC5 (an `'unusable'` verdict blocks Next and shows the
 * reason).
 */
describe('BootstrapWizard existing-folder game-data source (story 089 D4)', () => {
  it('offers the existing-folder choice even when no store source was detected (AC1)', async () => {
    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-free-download')
    expect(screen.queryByTestId('bootstrap-gamedata-choice-store-copy')).toBeNull()
    expect(screen.getByTestId('bootstrap-gamedata-choice-existing-folder')).toBeTruthy()
  })

  it('blocks Next until a folder is browsed and its verdict resolves, then proceeds for a retail verdict (AC2)', async () => {
    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-existing-folder')
    fireEvent.click(screen.getByTestId('bootstrap-gamedata-choice-existing-folder'))
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))

    await screen.findByTestId('bootstrap-gamedata-folder-verdict-retail')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByTestId('bootstrap-target-path-input')

    await waitFor(() =>
      expect(getGameDataSourceVerdict).toHaveBeenCalledWith('D:\\Games\\Quake II'),
    )
  })

  it('still allows Next for a demo verdict (AC4)', async () => {
    getGameDataSourceVerdict.mockResolvedValueOnce({
      ok: true,
      value: {
        rootPath: 'D:\\Games\\Quake II',
        kind: 'demo',
        paks: [{ name: 'pak0.pak', sizeBytes: 1234, retail: false }],
      },
    })

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-existing-folder')
    fireEvent.click(screen.getByTestId('bootstrap-gamedata-choice-existing-folder'))
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))

    await screen.findByTestId('bootstrap-gamedata-folder-verdict-demo')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it('keeps Next disabled and shows the reason for an unusable verdict (AC5)', async () => {
    getGameDataSourceVerdict.mockResolvedValueOnce({
      ok: true,
      value: {
        rootPath: 'D:\\Games\\Quake II',
        kind: 'unusable',
        reason: 'bootstrap.gameDataSource.pak0Missing',
        paks: [],
      },
    })

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-existing-folder')
    fireEvent.click(screen.getByTestId('bootstrap-gamedata-choice-existing-folder'))
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))

    const reason = await screen.findByTestId('bootstrap-gamedata-folder-verdict-unusable')
    expect(reason.textContent).toContain(
      "This folder's baseq2 directory has no pak0.pak, so no game data could be found in it.",
    )
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends dataSource/copySourcePath for the picked folder when the run starts', async () => {
    getBootstrapSummary.mockResolvedValueOnce({
      ok: true,
      value: {
        targetPath: 'D:\\Games\\Quake II',
        engine: 'q2pro',
        totalSizeBytes: 1_000_000,
        packages: [{ id: 'engine-q2pro', role: 'engine', version: '1.0.0', sizeBytes: 1_000_000 }],
        includeVideoAndPlayers: false,
        dataSource: 'existing-folder',
        copySource: { path: 'D:\\Games\\Quake II' },
      } satisfies BootstrapSummary,
    })

    render(createElement(BootstrapWizard))

    await screen.findByTestId('bootstrap-engine-q2pro')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-gamedata-choice-existing-folder')
    fireEvent.click(screen.getByTestId('bootstrap-gamedata-choice-existing-folder'))
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await screen.findByTestId('bootstrap-gamedata-folder-verdict-retail')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-target-path-input')
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('bootstrap-confirm-total-size')
    await waitFor(() =>
      expect((screen.getByTestId('bootstrap-confirm-start') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )

    // Story 089 D5 (AC6): the confirm step names the chosen folder, the same way it already does
    // for a `'store-copy'` summary - and (Decisions: "no video/players toggle for this source")
    // the toggle is hidden outright, not merely disabled with a reason.
    const copySource = screen.getByTestId('bootstrap-confirm-copy-source')
    expect(copySource.textContent).toContain('D:\\Games\\Quake II')
    expect(screen.queryByLabelText('Include videos and player models')).toBeNull()
    expect(screen.queryByTestId('bootstrap-confirm-include-extras-disabled')).toBeNull()

    fireEvent.click(screen.getByTestId('bootstrap-confirm-start'))

    await waitFor(() =>
      expect(startBootstrapInstall).toHaveBeenCalledWith(
        expect.objectContaining({
          dataSource: 'existing-folder',
          copySourcePath: 'D:\\Games\\Quake II',
          includeVideoAndPlayers: false,
        }),
      ),
    )
  })
})
