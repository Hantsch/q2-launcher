// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DownloadDiagnostics } from '@shared/modules/downloads'
import { initI18n } from '../../../i18n'
import { FailureCauseDetail } from './FailureCauseDetail'

/**
 * Story 078 D5. Covers the shared cause-detail component mounted by both `FailureLogEntry` (D6)
 * and the bootstrap wizard's `RunningStep` (D7): the per-package step summary (AC1), the target
 * verdict/failing-checks block resolved through `messageKey` (AC2), the closed-by-default native
 * `<details>` (AC3), and the no-diagnostics no-render case (AC6).
 */

function makeDiagnostics(overrides: Partial<DownloadDiagnostics> = {}): DownloadDiagnostics {
  return {
    jobId: 'job-1',
    kind: 'bootstrap',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    errorKey: 'downloads.error.installationNotPlayable',
    packages: [],
    logTail: [],
    ...overrides,
  }
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('FailureCauseDetail', () => {
  it('every package downloaded but none contributed reads as exactly that', () => {
    const diagnostics = makeDiagnostics({
      packages: [
        {
          id: 'engine-q2pro',
          url: 'https://mirror.test/engine.zip',
          sizeBytes: 1_000_000,
          verified: true,
          extracted: true,
          contributed: false,
        },
        {
          id: 'demo-data',
          url: 'https://mirror.test/demo.zip',
          sizeBytes: 2_000_000,
          verified: true,
          extracted: true,
          contributed: false,
        },
      ],
    })

    render(createElement(FailureCauseDetail, { diagnostics }))

    // Force the disclosure open so the body enters the accessible tree for assertions.
    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true

    expect(
      screen.getByText('engine-q2pro: downloaded, verified and extracted, but did not contribute to the installation'),
    ).toBeTruthy()
    expect(
      screen.getByText('demo-data: downloaded, verified and extracted, but did not contribute to the installation'),
    ).toBeTruthy()
  })

  it('a package extracted before assembly ever ran reads as extracted, not as rejected (M3)', () => {
    // `contributed: undefined` (never set - `diagnostics.assembly` is entirely absent, e.g. this
    // job failed downloading a later package before assembly ever started) must not be told apart
    // from `contributed: false` (assembly ran and this package's extraction served nothing) - the
    // former is not this package's fault and must not claim it "did not contribute".
    const diagnostics = makeDiagnostics({
      packages: [
        {
          id: 'engine-q2pro',
          url: 'https://mirror.test/engine.zip',
          sizeBytes: 1_000_000,
          verified: true,
          extracted: true,
          // contributed intentionally omitted.
        },
      ],
    })

    render(createElement(FailureCauseDetail, { diagnostics }))

    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true

    expect(screen.getByText('engine-q2pro: downloaded, verified and extracted')).toBeTruthy()
    expect(screen.queryByText(/did not contribute/)).toBeNull()
  })

  it('the target verdict and each failing check render through their messageKey', () => {
    const diagnostics = makeDiagnostics({
      target: {
        targetPath: 'D:\\Games\\Quake II',
        verdict: 'invalid',
        missingChecks: [
          { id: 'base-paks', messageKey: 'validation.pak0Missing' },
          { id: 'executable', messageKey: 'validation.pak0MissingButPaksPresent' },
        ],
      },
    })

    render(createElement(FailureCauseDetail, { diagnostics }))

    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true

    expect(screen.getByText('Installation check:')).toBeTruthy()
    expect(screen.getByText('Not playable')).toBeTruthy()
    expect(screen.queryByText('validation.pak0Missing')).toBeNull()
    expect(screen.queryByText('validation.pak0MissingButPaksPresent')).toBeNull()
    expect(
      screen.getByText('pak0.pak is missing from baseq2. Quake II cannot start without it.'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'pak0.pak is missing, but other pak files are present. This may be a repacked or remastered install.',
      ),
    ).toBeTruthy()
  })

  it('the detail is closed on first render', () => {
    // Real browsers keep a closed <details>' non-summary content out of the accessible tree
    // natively (no application code makes that happen); jsdom does not model that rendering
    // behaviour, so the assertion this unit test can make is the DOM-level fact that drives it -
    // the element renders with no `open` attribute/property, never forced open by a default prop.
    // The full accessible-tree behaviour is verified against a real browser by the e2e flow (D8).
    const diagnostics = makeDiagnostics({
      packages: [
        {
          id: 'demo-data',
          url: 'https://mirror.test/demo.zip',
          sizeBytes: 2_000_000,
          verified: true,
          extracted: true,
          contributed: true,
        },
      ],
    })

    render(createElement(FailureCauseDetail, { diagnostics }))

    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.hasAttribute('open')).toBe(false)
  })

  it('a failure without diagnostics renders nothing', () => {
    const { container } = render(
      createElement(FailureCauseDetail, { diagnostics: undefined }),
    )

    expect(container.innerHTML).toBe('')
    expect(document.querySelector('details')).toBeNull()
  })
})
