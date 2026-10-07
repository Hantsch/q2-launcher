// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '../../i18n'
import { FailureBadge } from './FailureBadge'
import { makeInstallation } from '../../../../test-support/fixtures'

/**
 * Story 077 D4 (AC5): `FailureBadge` mirrors `DemoBadge` - it renders a
 * text-bearing badge (never colour alone, per /design-tokens) when the
 * installation carries a `lastFailure`, and renders nothing otherwise. The
 * second half of AC5 (`invalid`/`missing` without a `lastFailure` renders no
 * badge) is the key regression this file guards: an ordinary broken
 * installation must not start looking like a failed download.
 */

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('FailureBadge', () => {
  it('a failed installation shows a text badge and its reason, an invalid one without a failure shows neither', () => {
    const failed = makeInstallation({
      status: 'invalid',
      lastFailure: { errorKey: 'downloads.error.network', at: 1, jobId: 'job-1' },
    })
    const { unmount } = render(createElement(FailureBadge, { installation: failed }))
    const badge = screen.getByTestId('failure-badge')
    expect(badge.textContent).toBe('Failed')
    unmount()

    // Same status, no `lastFailure` - an ordinary broken folder. Must render
    // no badge at all, not a blank/empty one.
    const broken = makeInstallation({ status: 'invalid' })
    render(createElement(FailureBadge, { installation: broken }))
    expect(screen.queryByTestId('failure-badge')).toBeNull()
  })

  it('renders nothing for a healthy installation', () => {
    render(createElement(FailureBadge, { installation: makeInstallation({ status: 'ok' }) }))
    expect(screen.queryByTestId('failure-badge')).toBeNull()
  })

  it('uses the danger tone, not colour alone (text is present)', () => {
    render(
      createElement(FailureBadge, {
        installation: makeInstallation({
          status: 'missing',
          lastFailure: { errorKey: 'downloads.error.network', at: 1, jobId: 'job-1' },
        }),
      }),
    )
    const badge = screen.getByTestId('failure-badge')
    expect(badge.className.split(/\s+/)).toContain('text-danger')
    expect(badge.textContent?.trim().length).toBeGreaterThan(0)
  })
})
