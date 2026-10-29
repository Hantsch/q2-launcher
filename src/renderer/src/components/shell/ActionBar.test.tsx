// @vitest-environment jsdom
import { createTimeline } from '../../modules/replays/optimistic-timeline'
import { makeJob } from '../../../../test-support/fixtures'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Installation, Job } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { usePlaybackStore } from '../../modules/replays/playback-store'
import { type ContributedAction, usePrimaryActionStore } from '../../lib/primary-action'
import { ActionBar } from './ActionBar'
import { makeInstallation } from '../../../../test-support/fixtures'

/**
 * Story 091 D3 (AC2, AC5's renderer half). Mirrors `DownloadsView.test.tsx`'s conventions: the
 * real Zustand store is seeded directly via `useLauncher.setState`, and `window.q2` is stubbed at
 * module scope (via `vi.hoisted`) since `lib/bridge.ts` resolves it eagerly.
 */

const bridge = vi.hoisted(() => {
  /** Per-channel answers; a channel without one resolves `{ ok: true }`. */
  const answers: Record<string, (payload: unknown) => unknown> = {}
  const invoke = vi.fn(async (channel: string, payload?: unknown) =>
    answers[channel] ? answers[channel](payload) : { ok: true },
  )
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on: vi.fn(() => () => {}) }
  return { answers, invoke }
})

// The footer's map choice is a release feature, not a dev-module one.
vi.mock('@shared/dev-modules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/dev-modules')>()),
  DEV_MODULES: false,
}))

function actionBarJob(overrides: Partial<Job> = {}): Job {
  return makeJob({ installationId: 'inst-1', ...overrides })
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  for (const channel of Object.keys(bridge.answers)) delete bridge.answers[channel]
  usePlaybackStore.setState({ session: null })
  usePrimaryActionStore.setState({ owner: null, action: null })
  useLauncher.setState({
    launch: { phase: 'idle', installationId: null },
    jobs: [],
    installations: [],
    settings: { ...DEFAULT_SETTINGS },
  })
})

describe('ActionBar', () => {
  it('JobReadout renders a waiting job reason, not the generic download readout', async () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [
        actionBarJob({
          status: 'waiting',
          progress: { ratio: null },
          waitingReason: { key: 'jobs.waiting.gameRunning' },
        }),
      ],
    })

    render(createElement(ActionBar))

    expect(await screen.findByText('Waiting for the game to close')).toBeTruthy()
    expect(screen.queryByText(/Downloading/)).toBeNull()
  })

  it('resolvePrimaryAction disables Play with a reason while a job holds the write lock on this installation', async () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [actionBarJob({ status: 'running', writeLock: true })],
    })

    render(createElement(ActionBar))

    const playButton = await screen.findByTestId('actionbar-play')
    expect(playButton.hasAttribute('disabled')).toBe(true)
    expect(playButton.getAttribute('data-action')).toBe('busy')
    expect(playButton.textContent).toContain('Writing')
  })

  it('handed-off reads as not tracked and keeps Play enabled', async () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [],
      launch: { phase: 'handed-off', installationId: 'inst-1' },
    })

    render(createElement(ActionBar))

    expect(await screen.findByText('Handed off to Steam — not tracked')).toBeTruthy()
    const playButton = await screen.findByTestId('actionbar-play')
    expect(playButton.hasAttribute('disabled')).toBe(false)
  })

  it('story 093 D6: clicking Repair opens the downloads module repair dialog for the installation, not a route change', async () => {
    useLauncher.setState({
      installations: [makeInstallation({ status: 'invalid' })],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [],
    })

    render(createElement(ActionBar))

    const playButton = await screen.findByTestId('actionbar-play')
    expect(playButton.getAttribute('data-action')).toBe('repair')

    fireEvent.click(playButton)

    expect(useLauncher.getState().dialog).toEqual({
      kind: 'module',
      moduleId: 'downloads',
      view: 'repair',
      installationId: 'inst-1',
    })
  })

  it('during a demo session Running becomes an enabled Stop demo', async () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [],
      launch: { phase: 'running', installationId: 'inst-1', pid: 1 },
    })
    const requestStop = vi.fn(async () => null)
    usePlaybackStore.setState({
      requestStop,
      session: {
        demoName: 'a.dm2',
        demoId: null,
        archived: false,
        pendingSeekS: null,
        knownDurationMs: null,
        view: null,
        speed: 1,
        volume: { percent: 100, muted: false },
        mode: 'preview',
        cinemaAvailability: { available: true },
        controlsUnavailable: null,
        fullscreen: false,
        stopping: false,
        optimistic: createTimeline({ view: null }, 0),
        waiting: new Set(),
      },
    })

    render(createElement(ActionBar))

    const button = await screen.findByTestId('actionbar-play')
    expect(button.textContent).toContain('Stop demo')
    expect(button.getAttribute('data-action')).toBe('stop')
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    expect(requestStop).toHaveBeenCalledTimes(1)
  })

  describe('story 180 D1: a tab contributes the primary action', () => {
    const seed = (over: Partial<Installation> = {}, jobs: Job[] = []): void => {
      useLauncher.setState({
        installations: [makeInstallation(over)],
        settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
        jobs,
        route: '/replays',
      })
    }
    const contribute = (over: Partial<ContributedAction> = {}, owner = '/replays') => {
      const run = vi.fn()
      usePrimaryActionStore.setState({
        owner,
        action: {
          id: 'view-demo',
          labelKey: 'installation.action.view',
          disabled: false,
          run,
          ...over,
        },
      })
      return run
    }

    it('a tab without a contribution shows Play and plays', async () => {
      seed()
      render(createElement(ActionBar))
      const button = await screen.findByTestId('actionbar-play')
      expect(button.textContent).toContain('Play')
      expect(button.getAttribute('data-action')).toBe('play')
      fireEvent.click(button)
      expect(
        (globalThis as unknown as { q2: { invoke: ReturnType<typeof vi.fn> } }).q2.invoke,
      ).toHaveBeenCalled()
    })

    it('a contribution for the active route replaces Play', async () => {
      seed()
      const run = contribute()
      render(createElement(ActionBar))
      const button = await screen.findByTestId('actionbar-play')
      expect(button.textContent).toContain('View')
      expect(button.textContent).not.toContain('Play')
      expect(button.getAttribute('data-action')).toBe('view-demo')
      fireEvent.click(button)
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('a contribution for another route is ignored', async () => {
      seed()
      const run = contribute({}, '/config')
      render(createElement(ActionBar))
      const button = await screen.findByTestId('actionbar-play')
      expect(button.textContent).toContain('Play')
      expect(button.getAttribute('data-action')).toBe('play')
      fireEvent.click(button)
      expect(run).not.toHaveBeenCalled()
    })

    it.each([
      ['missing → locate', { status: 'missing' as const }, [], 'locate'],
      ['invalid → repair', { status: 'invalid' as const }, [], 'repair'],
      ['job → install', {}, [{}], 'busy'],
      ['write lock → writing', {}, [{ writeLock: true, progress: { ratio: 0.99 } }], 'busy'],
    ])('installation states win over a contribution: %s', async (_name, inst, jobs, kind) => {
      seed(
        inst,
        jobs.map((j) => actionBarJob(j)),
      )
      const run = contribute()
      render(createElement(ActionBar))
      const button = await screen.findByTestId('actionbar-play')
      expect(button.getAttribute('data-action')).toBe(kind)
      expect(button.textContent).not.toContain('View')
      fireEvent.click(button)
      expect(run).not.toHaveBeenCalled()
    })

    it('installation states win over a contribution: running → running/stop', async () => {
      seed()
      useLauncher.setState({ launch: { phase: 'running', installationId: 'inst-1', pid: 1 } })
      contribute()
      render(createElement(ActionBar))
      const button = await screen.findByTestId('actionbar-play')
      expect(button.textContent).toContain('Running')
      expect(button.textContent).not.toContain('View')
    })

    it("a disabled contribution's reason is visible text", async () => {
      seed()
      contribute({ disabled: true, reason: { key: 'validation.noExecutable' } })
      render(createElement(ActionBar))
      const button = await screen.findByTestId('actionbar-play')
      const reason = await screen.findByTestId('actionbar-action-reason')
      expect(button.hasAttribute('disabled')).toBe(true)
      expect(reason.textContent?.length).toBeGreaterThan(0)
      expect(button.getAttribute('aria-describedby')).toBe(reason.id)
    })

    it('an error is announced as an alert', async () => {
      seed()
      contribute({ error: { key: 'validation.noExecutable' } })
      render(createElement(ActionBar))
      const error = await screen.findByTestId('actionbar-action-error')
      expect(error.getAttribute('role')).toBe('alert')
    })
  })

  describe('story 181 D2: the Servers Join contribution', () => {
    const joinContribution = (over: Partial<ContributedAction> = {}) => {
      const run = vi.fn()
      usePrimaryActionStore.setState({
        owner: '/servers',
        action: {
          id: 'join-server',
          labelKey: 'common.action.join',
          disabled: false,
          run,
          ...over,
        },
      })
      return run
    }
    const seed = (over: Partial<Installation> = {}, jobs: Job[] = []): void => {
      useLauncher.setState({
        installations: [makeInstallation(over)],
        settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
        jobs,
        route: '/servers',
      })
    }

    it('installation states win over the Servers Join contribution', async () => {
      const cases: Array<[string, Partial<Installation>, Partial<Job>[], string, boolean]> = [
        ['missing', { status: 'missing' }, [], 'Locate', false],
        ['broken', { status: 'invalid' }, [], 'Repair', false],
        ['job', {}, [{}], 'Install', false],
        ['write lock', {}, [{ writeLock: true, progress: { ratio: 0.99 } }], 'Writing', false],
        ['running', {}, [], 'Running', true],
      ]
      for (const [name, inst, jobs, label, running] of cases) {
        seed(
          inst,
          jobs.map((j) => actionBarJob(j)),
        )
        if (running) {
          useLauncher.setState({ launch: { phase: 'running', installationId: 'inst-1', pid: 1 } })
        }
        const run = joinContribution()
        const { unmount } = render(createElement(ActionBar))
        const button = await screen.findByTestId('actionbar-play')
        expect(button.textContent, name).toContain(label)
        expect(button.textContent, name).not.toContain('Join')
        fireEvent.click(button)
        expect(run, name).not.toHaveBeenCalled()
        unmount()
        useLauncher.setState({ launch: { phase: 'idle', installationId: null } })
      }
    })

    it("no installation shows the contribution's label disabled with its reason in the readout", async () => {
      useLauncher.setState({ installations: [], route: '/servers' })
      const run = joinContribution({
        disabled: false,
        reason: { key: 'servers.join.noInstallation' },
      })
      render(createElement(ActionBar))
      const button = await screen.findByTestId('actionbar-play')
      expect(button.textContent).toContain('Join')
      expect(button.hasAttribute('disabled')).toBe(true)
      const reason = await screen.findByTestId('actionbar-action-reason')
      expect(reason.textContent).toBe('Choose an active installation to join a server.')
      fireEvent.click(button)
      expect(run).not.toHaveBeenCalled()
    })
  })

  describe('Launch with select', () => {
    const seedWithMods = (route: string): void => {
      useLauncher.setState({
        installations: [makeInstallation({ gameDirs: ['baseq2', 'ctf'] })],
        settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
        jobs: [],
        route,
      })
    }

    it('the Launch with select is not rendered on the servers and replays routes', async () => {
      for (const route of ['/servers', '/replays']) {
        seedWithMods(route)
        const { unmount } = render(createElement(ActionBar))
        await screen.findByTestId('actionbar-play')
        expect(screen.queryByLabelText('Launch with'), route).toBeNull()
        unmount()
      }
    })

    it('the Launch with select is rendered on home and library when the installation has mods', async () => {
      for (const route of ['/home', '/library']) {
        seedWithMods(route)
        const { unmount } = render(createElement(ActionBar))
        expect(await screen.findByLabelText('Launch with'), route).toBeTruthy()
        unmount()
      }
    })
  })

  describe('Map select', () => {
    const mapsByDir = (lists: Record<string, string[] | 'fail'>): void => {
      bridge.answers['installations:listMaps'] = (payload) => {
        const list = lists[(payload as { gameDir: string }).gameDir] ?? []
        return list === 'fail'
          ? { ok: false, error: { key: 'ipc.error.unreachable' } }
          : { ok: true, value: { maps: list.map((name) => ({ name })) } }
      }
    }
    const seed = (route: string, overrides: Partial<Installation> = {}): void => {
      useLauncher.setState({
        installations: [makeInstallation(overrides)],
        settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
        jobs: [],
        route,
      })
    }
    const updates = (): unknown[] =>
      bridge.invoke.mock.calls
        .filter(([channel]) => channel === 'installations:update')
        .map(([, payload]) => payload)
    const loadedMapSelect = async (): Promise<HTMLSelectElement> => {
      const select = (await screen.findByTestId('actionbar-map')) as HTMLSelectElement
      await waitFor(() => expect(select.disabled).toBe(false))
      return select
    }

    it('a release build shows the Map select', async () => {
      bridge.answers['installations:listMaps'] = () => ({
        ok: true,
        value: { maps: [{ name: 'q2dm1', title: 'The Edge' }, { name: 'base1' }] },
      })
      seed('/home')
      render(createElement(ActionBar))

      const select = await loadedMapSelect()
      expect([...select.options].map((option) => option.textContent)).toEqual([
        'No map',
        'q2dm1 — The Edge',
        'base1',
      ])
      expect(screen.queryByTestId('actionbar-play-with')).toBeNull()
    })

    it('the Map select is hidden on Servers and Demos', async () => {
      mapsByDir({ '': ['q2dm1'] })
      for (const route of ['/servers', '/replays']) {
        seed(route)
        const { unmount } = render(createElement(ActionBar))
        await screen.findByTestId('actionbar-play')
        expect(screen.queryByTestId('actionbar-map'), route).toBeNull()
        unmount()
      }
      for (const route of ['/home', '/config', '/settings']) {
        seed(route)
        const { unmount } = render(createElement(ActionBar))
        expect(await screen.findByTestId('actionbar-map'), route).toBeTruthy()
        unmount()
      }
    })

    it('the Map select shows without mods', async () => {
      mapsByDir({ '': ['q2dm1'] })
      seed('/home', { gameDirs: ['baseq2'] })
      render(createElement(ActionBar))

      expect(await loadedMapSelect()).toBeTruthy()
      expect(screen.queryByLabelText('Launch with')).toBeNull()
    })

    it('choosing a map saves it on the installation', async () => {
      mapsByDir({ '': ['q2dm1'] })
      seed('/home')
      render(createElement(ActionBar))

      fireEvent.change(await loadedMapSelect(), { target: { value: 'q2dm1' } })
      await waitFor(() => expect(updates()).toEqual([{ id: 'inst-1', activeMap: 'q2dm1' }]))
    })

    it('switching Launch with to a mod without the map writes the game dir and No map in one update', async () => {
      mapsByDir({ '': ['q2dm1'], ctf: ['ctf1'] })
      seed('/home', { gameDirs: ['baseq2', 'ctf'], activeMap: 'q2dm1' })
      render(createElement(ActionBar))
      await loadedMapSelect()

      fireEvent.change(screen.getByLabelText('Launch with'), { target: { value: 'ctf' } })

      await waitFor(() => expect(updates()).toHaveLength(1))
      expect(updates()).toEqual([{ id: 'inst-1', activeGameDir: 'ctf', activeMap: '' }])
    })

    it('switching Launch with to a mod that has the map keeps it', async () => {
      mapsByDir({ '': ['q2dm1'], ctf: ['q2dm1', 'ctf1'] })
      seed('/home', { gameDirs: ['baseq2', 'ctf'], activeMap: 'q2dm1' })
      render(createElement(ActionBar))
      await loadedMapSelect()

      fireEvent.change(screen.getByLabelText('Launch with'), { target: { value: 'ctf' } })

      await waitFor(() =>
        expect(updates()).toEqual([{ id: 'inst-1', activeGameDir: 'ctf', activeMap: 'q2dm1' }]),
      )
    })

    it('switching Launch with when the new mod cannot be listed writes the game dir and No map', async () => {
      mapsByDir({ '': ['q2dm1'], ctf: 'fail' })
      seed('/home', { gameDirs: ['baseq2', 'ctf'], activeMap: 'q2dm1' })
      render(createElement(ActionBar))
      await loadedMapSelect()

      fireEvent.change(screen.getByLabelText('Launch with'), { target: { value: 'ctf' } })

      await waitFor(() =>
        expect(updates()).toEqual([{ id: 'inst-1', activeGameDir: 'ctf', activeMap: '' }]),
      )
    })

    it('a loaded list without the saved map clears it', async () => {
      mapsByDir({ '': ['q2dm1'] })
      seed('/home', { activeMap: 'gone' })
      render(createElement(ActionBar))

      await waitFor(() => expect(updates()).toEqual([{ id: 'inst-1', activeMap: '' }]))
    })

    it('a list read on an installation that is not ready does not clear the saved map', async () => {
      mapsByDir({ '': [] })
      seed('/home', { activeMap: 'q2dm1', status: 'missing' })
      render(createElement(ActionBar))

      const select = await loadedMapSelect()
      expect(select.value).toBe('q2dm1')
      expect(updates()).toEqual([])
    })

    it('a failed list keeps the saved map', async () => {
      mapsByDir({ '': 'fail' })
      seed('/home', { activeMap: 'q2dm1' })
      render(createElement(ActionBar))

      const select = await loadedMapSelect()
      expect(select.value).toBe('q2dm1')
      expect(updates()).toEqual([])
    })
  })

  it('a normal running game still shows a disabled Running', async () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [],
      launch: { phase: 'running', installationId: 'inst-1', pid: 1 },
    })

    render(createElement(ActionBar))

    const button = await screen.findByTestId('actionbar-play')
    expect(button.textContent).toContain('Running')
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
