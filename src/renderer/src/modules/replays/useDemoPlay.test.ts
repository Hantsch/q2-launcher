// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'
import type { DemoRow } from '@shared/modules/replays'
import { i18next as i18n, initI18n } from '../../i18n'

/**
 * Story 180 D2 - the play logic moved out of story 159 D3's `DemoPlayAction` into `useDemoPlay`;
 * these are that component's cases, asserted on the hook. Faked store + stubbed client.
 */
const invokeMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: null })))
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }
})

const playDemo = vi.fn()
const playIntegrated = vi.hoisted(() =>
  vi.fn(
    async (_args: unknown, _hooks: import('./integrated/integrated-session').IntegratedHooks) => {},
  ),
)
const stopIntegrated = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./integrated/integrated-session', () => ({ playIntegrated, stopIntegrated }))
vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    readPlaybackMode: () => new Promise(() => {}),
    setPlaybackMode: async (mode: 'engine' | 'integrated') => ({ ok: true as const, value: mode }),
    playDemo: (...args: unknown[]) => playDemo(...args),
    onPlaybackPosition: () => () => {},
    onPlaybackState: () => () => {},
    onPlaybackDisplay: () => () => {},
    playbackDisplayRead: () => new Promise(() => {}),
  }),
)

let useDemoPlay: typeof import('./useDemoPlay').useDemoPlay
let useLauncher: typeof import('../../store/useLauncher').useLauncher
let usePlaybackStore: typeof import('./playback-store').usePlaybackStore
let usePlaybackModeStore: typeof import('./playback-mode-store').usePlaybackModeStore

beforeAll(async () => {
  await initI18n('en')
  ;({ useDemoPlay } = await import('./useDemoPlay'))
  ;({ useLauncher } = await import('../../store/useLauncher'))
  ;({ usePlaybackStore } = await import('./playback-store'))
  ;({ usePlaybackModeStore } = await import('./playback-mode-store'))
})

afterEach(() => {
  cleanup()
  usePlaybackModeStore.setState({ mode: 'engine' })
  playDemo.mockReset()
  usePlaybackStore.getState().endSession()
  usePlaybackStore.getState().disarmStage()
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
  return { id, engineKind, gameDirs: ['baseq2'], checks: [], runner: undefined, ...extra }
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

function hook(row: DemoRow | null = demo()) {
  return renderHook((props: { row: DemoRow | null }) => useDemoPlay(props.row), {
    initialProps: { row },
  })
}

/** The refusal as the user reads it: not playable, with a translated reason. */
function reasonText(row: DemoRow): string {
  const { result } = hook(row)
  const eligibility = result.current.eligibility
  if (eligibility === null || eligibility.ok) throw new Error('expected a refusal')
  return i18n.t(eligibility.reasonKey, eligibility.params)
}

const PLAYED = { ok: true, value: { stage: null } }

describe('useDemoPlay', () => {
  it('an eligible demo is playable and play sends only ids', async () => {
    setStore({})
    playDemo.mockResolvedValue(PLAYED)
    const { result } = hook()
    expect(result.current.eligibility?.ok).toBe(true)
    await act(() => result.current.play())
    expect(playDemo).toHaveBeenCalledWith({ demoId: '0123456789abcdef', installationId: 'q' })
    expect(result.current.busy).toBe(false)
  })

  it('no demo is not playable and carries no reason', () => {
    setStore({})
    const { result } = hook(null)
    expect(result.current.eligibility).toBeNull()
  })

  it('after the selection changes, play plays the new demo, not the previous one', async () => {
    setStore({})
    playDemo.mockResolvedValue(PLAYED)
    const { result, rerender } = hook(demo())
    rerender({ row: demo({ id: 'fedcba9876543210', fileName: 'b.dm2' }) })
    await act(() => result.current.play())
    expect(playDemo).toHaveBeenCalledTimes(1)
    expect(playDemo).toHaveBeenCalledWith({ demoId: 'fedcba9876543210', installationId: 'q' })
    expect(usePlaybackStore.getState().session?.demoName).toBe('b.dm2')
  })

  it('arms the stage, sends the measured rect and records the placement reason', async () => {
    setStore({})
    playDemo.mockImplementation(async () => {
      expect(usePlaybackStore.getState().stageArmed).toBe(true)
      return {
        ok: true,
        value: { stage: { ok: false, reasonKey: 'replays.stage.unavailable.wayland' } },
      }
    })
    const { result } = hook()
    usePlaybackStore.getState().setStageRect({ x: 1, y: 2, width: 800, height: 600 })
    await act(() => result.current.play())
    expect(playDemo).toHaveBeenCalledWith({
      demoId: '0123456789abcdef',
      installationId: 'q',
      stage: { x: 1, y: 2, width: 800, height: 600 },
    })
    expect(usePlaybackStore.getState().stageReason).toEqual({
      key: 'replays.stage.unavailable.wayland',
    })
  })

  it('plays without a stage when the final rect is unusably small', async () => {
    setStore({})
    playDemo.mockResolvedValue(PLAYED)
    const { result } = hook()
    usePlaybackStore.getState().setStageRect({ x: 0, y: 0, width: 2, height: 2 })
    await act(() => result.current.play())
    expect(playDemo).toHaveBeenCalledWith({ demoId: '0123456789abcdef', installationId: 'q' })
  })

  it('a failure disarms the stage again and reports the translated error', async () => {
    setStore({})
    playDemo.mockResolvedValue({
      ok: false,
      error: { key: 'replays.play.error.fileMissing' },
    })
    const { result } = hook()
    await act(() => result.current.play())
    expect(usePlaybackStore.getState().stageArmed).toBe(false)
    const error = result.current.error
    expect(error).not.toBeNull()
    expect(i18n.t(error!.key, error!.params)).toContain('no longer on disk')
  })

  it('the error clears when another demo is selected', async () => {
    setStore({})
    playDemo.mockResolvedValue({
      ok: false,
      error: { key: 'replays.play.error.fileMissing' },
    })
    const { result, rerender } = hook()
    await act(() => result.current.play())
    expect(result.current.error).not.toBeNull()
    rerender({ row: demo({ id: 'fedcba9876543210' }) })
    expect(result.current.error).toBeNull()
  })

  it('an active installation with neither Q2PRO nor R1Q2 refuses with the reason as text', () => {
    setStore({ installations: [inst('q', 'q2pro'), inst('r', 'q2')], active: 'r' })
    expect(reasonText(demo())).toContain('has neither')
  })

  it('a mod the installation does not list is an acknowledgeable warning; play(true) plays anyway', async () => {
    setStore({})
    playDemo.mockResolvedValue(PLAYED)
    const row = demo({ gameDir: 'opentdm' })
    expect(reasonText(row)).toContain('Mod `opentdm` is not fully installed')
    cleanup()
    const { result } = hook(row)
    const eligibility = result.current.eligibility
    expect(eligibility !== null && !eligibility.ok && eligibility.acknowledgeable).toBe(true)
    await act(() => result.current.play())
    expect(playDemo).not.toHaveBeenCalled()
    await act(() => result.current.play(true))
    expect(playDemo).toHaveBeenCalledWith({
      demoId: '0123456789abcdef',
      installationId: 'q',
      acknowledgeModMissing: true,
    })
  })

  it('a refusal that is not a warning is not acknowledgeable', () => {
    setStore({ phase: 'running' })
    const { result } = hook(demo({ gameDir: 'opentdm' }))
    const eligibility = result.current.eligibility
    expect(eligibility !== null && !eligibility.ok && eligibility.acknowledgeable === true).toBe(
      false,
    )
  })

  it('a running game refuses with the gameRunning reason', () => {
    setStore({ phase: 'running' })
    expect(reasonText(demo())).toContain('already running')
  })

  it('a demo from another installation, an extra folder or an archive is playable (via a copy)', () => {
    setStore({})
    const from = [
      { source: { kind: 'installation', installationId: 'other', gameDir: 'baseq2' } },
      { source: { kind: 'extraFolder', path: 'D:/demos' } },
      { archiveEntry: { archivePath: 'x.zip', entryPath: 'a.dm2' } },
    ]
    for (const over of from) {
      const { result } = hook(demo(over))
      expect(result.current.eligibility?.ok).toBe(true)
      cleanup()
    }
  })

  it('an unsafe file name stays playable (a copy is named by demo id)', () => {
    setStore({})
    const { result } = hook(demo({ fileName: 'my demo.dm2' }))
    expect(result.current.eligibility?.ok).toBe(true)
  })

  it('a Steam-launched installation refuses with the needsDirectLaunch reason', () => {
    setStore({ installations: [inst('q', 'q2pro', { runner: 'steam' })] })
    expect(reasonText(demo())).toContain('direct launch')
  })

  it('in integrated mode an mvd2 shows the engine-mode reason', () => {
    setStore({})
    usePlaybackModeStore.setState({ mode: 'integrated' })
    expect(reasonText(demo({ format: 'mvd2' }))).toContain('MVD2 demos play in engine mode for now')
  })

  it('integrated mode never calls the engine-mode play', async () => {
    setStore({})
    usePlaybackModeStore.setState({ mode: 'integrated' })
    const { result } = hook()
    expect(result.current.eligibility?.ok).toBe(true)
    await act(() => result.current.play())
    expect(playDemo).not.toHaveBeenCalled()
    const state = usePlaybackStore.getState()
    expect(playIntegrated).toHaveBeenCalledTimes(1)
    expect(state.stageArmed).toBe(true)
    expect(state.session).toMatchObject({
      demoName: 'a.dm2',
      kind: 'integrated',
      controlsUnavailable: { key: 'replays.player.unavailable.controlsComingSoon' },
    })
  })

  it('an integrated finish marks the session finished', async () => {
    setStore({})
    usePlaybackModeStore.setState({ mode: 'integrated' })
    playIntegrated.mockImplementationOnce(async (_args, hooks) => hooks.onFinished())
    const { result } = hook()
    await act(() => result.current.play())
    const state = usePlaybackStore.getState()
    expect(state.integratedPhase).toBe('finished')
    expect(state.session?.view?.ended).toBe(true)
  })

  it('an integrated refusal sets the stage reason with the engine-mode offer', async () => {
    setStore({})
    usePlaybackModeStore.setState({ mode: 'integrated' })
    playIntegrated.mockImplementationOnce(async (_args, hooks) =>
      hooks.onRefused({
        key: 'replays.integrated.error.dataTooLarge',
        params: { sizeMb: 612 },
        canPlayInEngineMode: true,
      }),
    )
    const { result } = hook()
    await act(() => result.current.play())
    const state = usePlaybackStore.getState()
    expect(state.stageReason).toEqual({
      key: 'replays.integrated.error.dataTooLarge',
      params: { sizeMb: 612 },
    })
    expect(state.stageEngineModeOffer).toBe(true)
    expect(state.integratedPhase).toBeNull()
  })

  it('playing in engine mode switches the mode, ends the integrated session and plays in the engine', async () => {
    setStore({})
    usePlaybackModeStore.setState({ mode: 'integrated' })
    playDemo.mockResolvedValue(PLAYED)
    stopIntegrated.mockClear()
    const { result } = hook()
    await act(() => result.current.play())
    await act(() => result.current.playInEngineMode())
    expect(stopIntegrated).toHaveBeenCalledTimes(1)
    expect(usePlaybackModeStore.getState().mode).toBe('engine')
    expect(playDemo).toHaveBeenCalledWith({ demoId: '0123456789abcdef', installationId: 'q' })
    expect(usePlaybackStore.getState().session?.kind).not.toBe('integrated')
  })

  it('engine mode still plays through demo.play', async () => {
    setStore({})
    playDemo.mockResolvedValue(PLAYED)
    const { result } = hook()
    await act(() => result.current.play())
    expect(playDemo).toHaveBeenCalledTimes(1)
  })
})
