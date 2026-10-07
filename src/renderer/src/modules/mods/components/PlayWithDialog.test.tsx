// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeInstallation } from '../../../../../test-support/fixtures'
import { mockClient } from '../../../test-support/mock-client'
import { initI18n } from '../../../i18n'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

const { listMaps, getLastLaunch, rememberLastLaunch } = vi.hoisted(() => ({
  listMaps: vi.fn(),
  getLastLaunch: vi.fn(),
  rememberLastLaunch: vi.fn(async () => ({ ok: true as const, value: null })),
}))
vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    listMaps,
    getLastLaunch,
    rememberLastLaunch,
  }),
)

const { PlayWithDialog } = await import('./PlayWithDialog')
const { useLauncher } = await import('../../../store/useLauncher')

beforeAll(async () => {
  await initI18n('en')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function open(remembered: unknown) {
  const play = vi.fn(async () => {})
  useLauncher.setState({
    installations: [
      makeInstallation({ activeGameDir: 'ctf', gameDirs: ['baseq2', 'ctf', 'xatrix'] }),
    ],
    play,
  })
  getLastLaunch.mockResolvedValue({ ok: true, value: remembered })
  listMaps.mockResolvedValue({
    ok: true,
    value: { maps: [{ name: 'q2dm1', title: 'The Edge' }, { name: 'base1' }] },
  })
  render(createElement(PlayWithDialog, { installationId: 'inst-1' }))
  return play
}

const startButton = (): HTMLButtonElement =>
  screen.getByTestId('play-with-start') as HTMLButtonElement

describe('PlayWithDialog', () => {
  it('a remembered mod that is gone falls back to the active game dir', async () => {
    open({ gameDir: 'removed', map: null, gameType: 'deathmatch' })
    await waitFor(() => expect(startButton().disabled).toBe(false))
    expect((screen.getByTestId('play-with-mod') as HTMLSelectElement).value).toBe('ctf')
  })

  it('a remembered map that is not listed falls back to No map', async () => {
    const play = open({ gameDir: 'ctf', map: 'gone', gameType: 'single' })
    await waitFor(() => expect(startButton().disabled).toBe(false))
    expect((screen.getByTestId('play-with-map') as HTMLSelectElement).value).toBe('')
    fireEvent.click(startButton())
    await waitFor(() => expect(play).toHaveBeenCalledWith('inst-1', { gameDir: 'ctf' }))
  })

  it('changing the mod keeps the map only when the new mod lists it', async () => {
    open({ gameDir: 'ctf', map: 'q2dm1', gameType: 'single' })
    const map = (): HTMLSelectElement => screen.getByTestId('play-with-map') as HTMLSelectElement
    await waitFor(() => expect(startButton().disabled).toBe(false))
    expect(map().value).toBe('q2dm1')

    listMaps.mockResolvedValue({ ok: true, value: { maps: [{ name: 'q2dm1' }, { name: 'x1' }] } })
    fireEvent.change(screen.getByTestId('play-with-mod'), { target: { value: 'baseq2' } })
    await waitFor(() => expect(screen.getByRole('option', { name: 'x1' })).toBeTruthy())
    expect(map().value).toBe('q2dm1')

    listMaps.mockResolvedValue({ ok: true, value: { maps: [{ name: 'other' }] } })
    fireEvent.change(screen.getByTestId('play-with-mod'), { target: { value: 'xatrix' } })
    await waitFor(() => expect(screen.getByRole('option', { name: 'other' })).toBeTruthy())
    expect(map().value).toBe('')
  })

  it('game type is disabled while No map is chosen', async () => {
    const play = open({ gameDir: 'ctf', map: 'q2dm1', gameType: 'single' })
    const type = (): HTMLSelectElement =>
      screen.getByTestId('play-with-gametype') as HTMLSelectElement
    await waitFor(() => expect(type().disabled).toBe(false))
    expect(screen.getByRole('option', { name: 'q2dm1 — The Edge' })).toBeTruthy()
    fireEvent.click(startButton())
    await waitFor(() =>
      expect(play).toHaveBeenCalledWith('inst-1', {
        gameDir: 'ctf',
        map: 'q2dm1',
        gameType: 'single',
      }),
    )
    fireEvent.change(screen.getByTestId('play-with-map'), { target: { value: '' } })
    expect(type().disabled).toBe(true)
  })
})
