// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { useAddInstallationEntries } from './useAddInstallationEntries'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: () => () => {} }
})

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAddInstallationEntries', () => {
  it('the entries are add-existing, detect, new — in that order, each with a hint', () => {
    const { result } = renderHook(() => useAddInstallationEntries())

    expect(result.current.map((entry) => entry.id)).toEqual(['add-existing', 'detect', 'new'])
    for (const entry of result.current) expect(entry.hint).toBeTruthy()
  })

  it('new installation opens the downloads bootstrap wizard', () => {
    const openDialog = vi.fn()
    useLauncher.setState({ openDialog })
    const { result } = renderHook(() => useAddInstallationEntries())

    result.current.find((entry) => entry.id === 'new')?.onSelect()

    expect(openDialog).toHaveBeenCalledWith({
      kind: 'module',
      moduleId: 'downloads',
      view: 'bootstrap-wizard',
    })
  })
})
