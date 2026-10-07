// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'
import type { ArchiveCacheStatus, DownloadsSettings } from '@shared/modules/downloads'
import { initI18n } from '../../i18n'
import { formatBytes } from '../../lib/format'
import { DownloadsSettingsSection } from './DownloadsSettingsSection'

/**
 * Story 072 D5. The client module is stubbed (mirrors `CreateProfileDialog.test.tsx`'s
 * `vi.mock('./client', ...)`) rather than stubbing `window.q2` and letting a real IPC call
 * reject, since these tests need to control the exact settings/cache-status values returned.
 */

const stubSettings: DownloadsSettings = {
  concurrentJobs: 3,
  archiveCacheBudgetGB: 10,
  downloadWhilePlayingAllowed: false,
}

const stubCacheStatus: ArchiveCacheStatus = {
  totalBytes: 2.5 * 1024 * 1024 * 1024, // 2.5 GB
  itemCount: 7,
}

const getDownloadsSettings = vi.fn(async () => ({ ok: true as const, value: stubSettings }))
const getArchiveCacheStatus = vi.fn(async () => ({ ok: true as const, value: stubCacheStatus }))
const patchDownloadsSettings = vi.fn(async (patch: Partial<DownloadsSettings>) => ({
  ok: true as const,
  value: { ...stubSettings, ...patch },
}))
const clearArchiveCache = vi.fn(async () => ({
  ok: true as const,
  value: { removedBytes: 0, removedCount: 0 },
}))

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    getDownloadsSettings: (...args: unknown[]) => getDownloadsSettings(...(args as [])),
    getArchiveCacheStatus: (...args: unknown[]) => getArchiveCacheStatus(...(args as [])),
    patchDownloadsSettings: (...args: unknown[]) =>
      patchDownloadsSettings(...(args as [Partial<DownloadsSettings>])),
    clearArchiveCache: (...args: unknown[]) => clearArchiveCache(...(args as [])),
  }),
)

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DownloadsSettingsSection', () => {
  it('the three controls render the current stubbed values, not the defaults', async () => {
    render(createElement(DownloadsSettingsSection))

    await waitFor(() => expect(getDownloadsSettings).toHaveBeenCalled())

    const concurrency = (await screen.findByTestId('downloads-settings-concurrency')).querySelector(
      'select',
    ) as HTMLSelectElement
    const cacheBudget = (
      await screen.findByTestId('downloads-settings-cache-budget')
    ).querySelector('select') as HTMLSelectElement
    const whilePlaying = (
      await screen.findByTestId('downloads-settings-while-playing')
    ).querySelector('[role="switch"]') as HTMLButtonElement

    await waitFor(() => expect(concurrency.value).toBe('3'))
    expect(cacheBudget.value).toBe('10')
    expect(whilePlaying.getAttribute('aria-checked')).toBe('false')
  })

  it('the clear confirm names what will be deleted (size, item count) before anything is called (AC4)', async () => {
    render(createElement(DownloadsSettingsSection))

    await waitFor(() => expect(getArchiveCacheStatus).toHaveBeenCalled())

    const clearButton = (await screen.findByTestId(
      'downloads-settings-clear-cache',
    )) as HTMLButtonElement
    await waitFor(() => expect(clearButton.disabled).toBe(false))
    fireEvent.click(clearButton)

    const confirmText = await screen.findByTestId('downloads-settings-clear-cache-confirm')
    // Names both the formatted size and the item count - matched through the same `formatBytes`
    // helper the component uses, so this stays correct regardless of the runner's locale.
    expect(confirmText.textContent).toContain(formatBytes(stubCacheStatus.totalBytes))
    expect(confirmText.textContent).toContain('7')

    // Critical: clearArchiveCache must not have been called yet - only an explicit confirm click
    // triggers it.
    expect(clearArchiveCache).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('downloads-settings-clear-cache-confirm-button'))
    await waitFor(() => expect(clearArchiveCache).toHaveBeenCalledTimes(1))
  })

  it('surfaces the actual removed bytes/count after a clear, not a hardcoded zero, and refreshes cache status', async () => {
    clearArchiveCache.mockResolvedValueOnce({
      ok: true,
      value: { removedBytes: 4_000_000, removedCount: 2 },
    })

    render(createElement(DownloadsSettingsSection))

    const clearButton = (await screen.findByTestId(
      'downloads-settings-clear-cache',
    )) as HTMLButtonElement
    await waitFor(() => expect(clearButton.disabled).toBe(false))
    fireEvent.click(clearButton)

    fireEvent.click(await screen.findByTestId('downloads-settings-clear-cache-confirm-button'))
    await waitFor(() => expect(clearArchiveCache).toHaveBeenCalledTimes(1))

    // The actual result - not {0, 0} - ends up surfaced to the user.
    const resultText = await screen.findByTestId('downloads-settings-clear-cache-result')
    expect(resultText.textContent).toContain(formatBytes(4_000_000))
    expect(resultText.textContent).toContain('2')

    // Cache status is refetched from main after a successful clear, not assumed to be empty.
    await waitFor(() => expect(getArchiveCacheStatus).toHaveBeenCalledTimes(2))
  })

  it('concurrency and download-while-playing are disabled and show the reason', async () => {
    render(createElement(DownloadsSettingsSection))

    const concurrency = (await screen.findByTestId('downloads-settings-concurrency')).querySelector(
      'select',
    ) as HTMLSelectElement
    const whilePlaying = (
      await screen.findByTestId('downloads-settings-while-playing')
    ).querySelector('[role="switch"]') as HTMLButtonElement
    await waitFor(() => expect(concurrency.value).toBe('3'))

    const reason = 'Not available yet: downloads run one at a time'
    const concurrencyReason = screen.getByTestId('downloads-settings-concurrency-reason')
    const whilePlayingReason = screen.getByTestId('downloads-settings-while-playing-reason')
    expect(concurrency.disabled).toBe(true)
    expect(whilePlaying.disabled).toBe(true)
    expect(concurrencyReason.textContent).toBe(reason)
    expect(whilePlayingReason.textContent).toBe(reason)
    expect(concurrency.getAttribute('aria-describedby')).toBe(concurrencyReason.id)
    expect(whilePlaying.getAttribute('aria-describedby')).toBe(whilePlayingReason.id)
  })

  it('refetches cache status after a settings patch (a lowered budget evicts server-side)', async () => {
    render(createElement(DownloadsSettingsSection))

    const budget = (await screen.findByTestId('downloads-settings-cache-budget')).querySelector(
      'select',
    ) as HTMLSelectElement
    await waitFor(() => expect(budget.value).toBe('10'))

    fireEvent.change(budget, { target: { value: '5' } })

    await waitFor(() => expect(patchDownloadsSettings).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getArchiveCacheStatus).toHaveBeenCalledTimes(2))
  })
})
