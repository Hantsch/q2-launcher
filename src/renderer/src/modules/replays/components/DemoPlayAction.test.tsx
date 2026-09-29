// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemoRow } from '@shared/modules/replays'
import { initI18n } from '../../../i18n'

/** Story 159 D3. Faked store + stubbed client, same idiom as `DemoFileActions.test.tsx`. */
const invokeMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: null })))
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }
})

const playDemo = vi.fn()
vi.mock('../client', () => ({
  playDemo: (...args: unknown[]) => playDemo(...args),
  onPlaybackPosition: () => () => {},
  onPlaybackState: () => () => {},
}))

let DemoPlayAction: typeof import('./DemoPlayAction').DemoPlayAction
let useLauncher: typeof import('../../../store/useLauncher').useLauncher

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoPlayAction } = await import('./DemoPlayAction'))
  ;({ useLauncher } = await import('../../../store/useLauncher'))
})

afterEach(() => {
  cleanup()
  playDemo.mockReset()
})

function demo(over: Record<string, unknown> = {}): DemoRow {
  return {
    id: '0123456789abcdef',
    fileName: 'a.dm2',
    readable: true,
    gameDir: 'baseq2',
    archiveEntry: null,
    source: { kind: 'installation', installationId: 'q', gameDir: 'baseq2' },
    ...over,
  } as unknown as DemoRow
}

function inst(id: string, engineKind: string, extra: Record<string, unknown> = {}) {
  return { id, engineKind, gameDirs: ['baseq2'], runner: undefined, ...extra }
}

function setStore(opts: {
  installations?: unknown[]
  active?: string | null
  platform?: string
  phase?: string
}) {
  useLauncher.setState({
    installations: (opts.installations ?? [inst('q', 'q2pro')]) as never,
    settings: { ...useLauncher.getState().settings, activeInstallationId: opts.active ?? 'q' },
    appInfo: { platform: opts.platform ?? 'win32' } as never,
    launch: { phase: (opts.phase ?? 'idle') as never, installationId: null },
  })
}

function reasonText(): string {
  const reason = screen.getByTestId('replays-demo-play-reason')
  const button = screen.getByTestId('replays-demo-play') as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-describedby')).toBe(reason.id)
  return reason.textContent ?? ''
}

describe('DemoPlayAction (story 159 D3)', () => {
  it('an eligible demo enables Play and sends only ids', async () => {
    setStore({})
    playDemo.mockResolvedValue({ ok: true, value: { ok: true, value: { stage: null } } })
    render(createElement(DemoPlayAction, { demo: demo() }))
    const button = screen.getByTestId('replays-demo-play') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByTestId('replays-demo-play-reason')).toBeNull()
    button.click()
    await vi.waitFor(() =>
      expect(playDemo).toHaveBeenCalledWith({ demoId: '0123456789abcdef', installationId: 'q' }),
    )
  })

  it('arms the stage, sends the measured rect and shows the placement reason', async () => {
    setStore({})
    const { usePlaybackStore } = await import('../playback-store')
    usePlaybackStore.getState().disarmStage()
    playDemo.mockImplementation(async () => {
      expect(usePlaybackStore.getState().stageArmed).toBe(true)
      return {
        ok: true,
        value: { ok: true, value: { stage: { placed: false, reason: { key: 'replays.stage.unavailable.wayland' } } } },
      }
    })
    render(createElement(DemoPlayAction, { demo: demo() }))
    usePlaybackStore.getState().setStageRect({ x: 1, y: 2, width: 800, height: 600 })
    screen.getByTestId('replays-demo-play').click()
    await vi.waitFor(() =>
      expect(playDemo).toHaveBeenCalledWith({
        demoId: '0123456789abcdef',
        installationId: 'q',
        stage: { x: 1, y: 2, width: 800, height: 600 },
      }),
    )
    await vi.waitFor(() =>
      expect(usePlaybackStore.getState().stageReason).toEqual({ key: 'replays.stage.unavailable.wayland' }),
    )
    usePlaybackStore.getState().endSession()
  })

  it('plays without a stage when the final rect is unusably small', async () => {
    setStore({})
    const { usePlaybackStore } = await import('../playback-store')
    usePlaybackStore.getState().disarmStage()
    playDemo.mockResolvedValue({ ok: true, value: { ok: true, value: { stage: null } } })
    render(createElement(DemoPlayAction, { demo: demo() }))
    usePlaybackStore.getState().setStageRect({ x: 0, y: 0, width: 2, height: 2 })
    screen.getByTestId('replays-demo-play').click()
    await vi.waitFor(() =>
      expect(playDemo).toHaveBeenCalledWith({ demoId: '0123456789abcdef', installationId: 'q' }),
    )
    usePlaybackStore.getState().endSession()
  })

  it('a failure disarms the stage again', async () => {
    setStore({})
    const { usePlaybackStore } = await import('../playback-store')
    playDemo.mockResolvedValue({ ok: true, value: { ok: false, error: { key: 'replays.play.error.fileMissing' } } })
    render(createElement(DemoPlayAction, { demo: demo() }))
    screen.getByTestId('replays-demo-play').click()
    await screen.findByTestId('replays-demo-play-error')
    expect(usePlaybackStore.getState().stageArmed).toBe(false)
  })

  it('a failure outcome shows an inline alert with the translated key', async () => {
    setStore({})
    playDemo.mockResolvedValue({
      ok: true,
      value: { ok: false, error: { key: 'replays.play.error.fileMissing' } },
    })
    render(createElement(DemoPlayAction, { demo: demo() }))
    screen.getByTestId('replays-demo-play').click()
    const alert = await screen.findByTestId('replays-demo-play-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('no longer on disk')
  })

  it('linux without a Q2PRO shows the reason as visible text', () => {
    setStore({ platform: 'linux', installations: [inst('r', 'r1q2')], active: 'r' })
    render(createElement(DemoPlayAction, { demo: demo() }))
    expect(reasonText()).toContain('Not available on Linux')
  })

  it('a non-Q2PRO active installation shows the notQ2pro reason', () => {
    setStore({ installations: [inst('q', 'q2pro'), inst('r', 'r1q2')], active: 'r' })
    render(createElement(DemoPlayAction, { demo: demo() }))
    expect(reasonText()).toContain('is not Q2PRO')
  })

  it('a mod the installation does not list shows a warning with the dir and a play-anyway button', async () => {
    setStore({})
    playDemo.mockResolvedValue({ ok: true, value: { ok: true, value: { stage: null } } })
    render(createElement(DemoPlayAction, { demo: demo({ gameDir: 'opentdm' }) }))
    expect(reasonText()).toContain('Mod `opentdm` is not fully installed')
    screen.getByTestId('replays-demo-play-anyway').click()
    await vi.waitFor(() =>
      expect(playDemo).toHaveBeenCalledWith({
        demoId: '0123456789abcdef',
        installationId: 'q',
        acknowledgeModMissing: true,
      }),
    )
  })

  it('no play-anyway button for a refusal that is not a warning', () => {
    setStore({ phase: 'running' })
    render(createElement(DemoPlayAction, { demo: demo({ gameDir: 'opentdm' }) }))
    expect(screen.queryByTestId('replays-demo-play-anyway')).toBeNull()
  })

  it('a running game shows the gameRunning reason', () => {
    setStore({ phase: 'running' })
    render(createElement(DemoPlayAction, { demo: demo() }))
    expect(reasonText()).toContain('already running')
  })

  it('a demo from another installation, an extra folder or an archive is playable (via a copy)', () => {
    setStore({})
    const from = [
      { source: { kind: 'installation', installationId: 'other', gameDir: 'baseq2' } },
      { source: { kind: 'extraFolder', path: 'D:/demos' } },
      { archiveEntry: { archivePath: 'x.zip', entryPath: 'a.dm2' } },
    ]
    for (const over of from) {
      render(createElement(DemoPlayAction, { demo: demo(over) }))
      expect((screen.getByTestId('replays-demo-play') as HTMLButtonElement).disabled).toBe(false)
      expect(screen.queryByTestId('replays-demo-play-reason')).toBeNull()
      cleanup()
    }
  })

  it('an unsafe file name stays playable (a copy is named by demo id)', () => {
    setStore({})
    render(createElement(DemoPlayAction, { demo: demo({ fileName: 'my demo.dm2' }) }))
    expect((screen.getByTestId('replays-demo-play') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByTestId('replays-demo-play-reason')).toBeNull()
  })

  it('a Steam-launched installation shows the needsDirectLaunch reason', () => {
    setStore({ installations: [inst('q', 'q2pro', { runner: 'steam' })] })
    render(createElement(DemoPlayAction, { demo: demo() }))
    expect(reasonText()).toContain('direct launch')
  })
})
