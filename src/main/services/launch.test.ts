import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECT_CFG_NAME, renderConnectCfg } from '@shared/launch/userinfo'
import {
  steamLaunchUrl,
  type DetectedRunner,
  type Installation,
  type LaunchInput,
  type LaunchState,
} from '@shared/types'
import { stubPlatform } from '../../test-support/platform'
import type { InstallationsService } from './installations'
import { LaunchService } from './launch'
import { buildLaunchArgs } from './launch-plan'
import type { WriteLockReader } from './write-guard'

/**
 * Story 091 D2, the inverse direction of the write guard (AC5): the game may not be
 * started while a job is copying into that installation's folder. `LaunchService`
 * had no test file of its own - `launch-plan.test.ts` covers the pure argument
 * building - so this suite covers only what D2 added: the refusal and the additive
 * `onStateChange` observer the guard resumes on.
 *
 * `spawn` is mocked, which is what lets "refuses *without starting the process*" be
 * an assertion rather than a hope.
 */

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
// Story 103 D5: `launch.ts` now also pulls in `runners.ts` (and, through it, the detection
// providers), which import two more helpers from this module. They are stubbed rather than left
// out because a mocked module has only the exports its factory returns - the real runner detection
// is never reached from here, since every test below hands `LaunchService` its own runner list.
vi.mock('../lib/fs-utils', () => ({
  isFile: () => Promise.resolve(true),
  isDirectory: () => Promise.resolve(false),
  listDir: () => Promise.resolve({ files: [], dirs: [] }),
  looksExecutable: () => Promise.resolve(false),
}))

// Story 125: every log line the launch path writes is captured, so "the password never reaches a
// log" is an assertion over all of them rather than over the one line someone thought of.
const logMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
  silly: vi.fn(),
  log: vi.fn(),
}))
vi.mock('../lib/logger', () => ({
  scopedLogger: () => logMock,
  logger: logMock,
  logFilePath: () => '',
}))

const { spawn } = await import('node:child_process')
const spawnMock = vi.mocked(spawn)

/** Everything any logger method was called with, flattened into one searchable string. */
function loggedText(): string {
  return Object.values(logMock)
    .flatMap((fn) => fn.mock.calls)
    .map((call) => call.map((part: unknown) => (part instanceof Error ? `${part.message} ${part.stack}` : String(part))).join(' '))
    .join('\n')
}

const INSTALLATION = 'inst-1'

const installation = {
  id: INSTALLATION,
  name: 'Quake II',
  rootPath: 'C:\\Games\\Quake2',
  executablePath: 'C:\\Games\\Quake2\\r1q2.exe',
  activeGameDir: 'baseq2',
  engineKind: 'r1q2',
  launchArgs: [],
} as unknown as Installation

/**
 * Story 103 D5: a Windows build sitting in a Linux installation folder - the tester's case. The
 * `executableKind` is what D2's inspection recorded from the file's own `MZ` header.
 */
const peInstallation = {
  id: INSTALLATION,
  name: 'Quake 2 (vanilla)',
  rootPath: '/home/user/.local/share/Steam/steamapps/common/Quake 2',
  executablePath: '/home/user/.local/share/Steam/steamapps/common/Quake 2/quake2.exe',
  executableKind: 'pe',
  activeGameDir: 'rogue',
  engineKind: 'unknown',
  launchArgs: ['+set', 'cl_maxfps', '60'],
} as unknown as Installation

const WINE: DetectedRunner = { kind: 'wine', id: 'wine', path: '/usr/bin/wine', available: true }
const NO_WINE: DetectedRunner = { kind: 'wine', id: 'wine', path: '', available: false }
const NATIVE: DetectedRunner = { kind: 'native', id: 'native', path: '', available: true }

/** Only the two members `LaunchService` uses; the rest of the service is irrelevant here. */
function fakeInstallations(row: Installation): InstallationsService {
  return {
    find: (id: string) => (id === row.id ? row : undefined),
    recordPlaySession: vi.fn(),
  } as unknown as InstallationsService
}

/** A child that reports nothing on its own, so the test controls the lifecycle. */
function fakeChild(): { once: ReturnType<typeof vi.fn>; pid: number } {
  return { once: vi.fn(), pid: 4242 }
}

function service(
  options: { isWriting?: boolean; installation?: Installation; runners?: DetectedRunner[] } = {},
): {
  launch: LaunchService
  broadcast: ReturnType<typeof vi.fn>
  detectRunners: ReturnType<typeof vi.fn>
} {
  const broadcast = vi.fn<(state: LaunchState) => void>()
  const guard: WriteLockReader = { isWriting: () => options.isWriting === true }
  const detectRunners = vi.fn(() => Promise.resolve(options.runners ?? [NATIVE]))
  const launch = new LaunchService({
    installations: fakeInstallations(options.installation ?? installation),
    onStateChange: broadcast,
    getWriteGuard: () => guard,
    detectRunners,
  })
  return { launch, broadcast, detectRunners }
}

let restorePlatform: (() => void) | undefined

beforeEach(() => {
  spawnMock.mockReset()
  for (const fn of Object.values(logMock)) fn.mockClear()
})

afterEach(() => {
  restorePlatform?.()
  restorePlatform = undefined
})

describe('LaunchService.start', () => {
  it('start() refuses while a job is writing into that installation', async () => {
    const { launch, broadcast } = service({ isWriting: true })
    spawnMock.mockImplementation(() => fakeChild() as never)

    const result = await launch.start({ installationId: INSTALLATION })

    expect(result).toEqual({ ok: false, error: { key: 'launch.error.installationBusy' } })
    // The point of the refusal: no process, and no launch state was entered either,
    // so nothing has to be unwound.
    expect(spawnMock).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(launch.getState()).toEqual({ phase: 'idle', installationId: null })
  })

  it('starts normally when no job holds the write lock', async () => {
    const { launch } = service({ isWriting: false })
    spawnMock.mockImplementation(() => fakeChild() as never)

    const result = await launch.start({ installationId: INSTALLATION })

    expect(result.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(launch.getState().phase).toBe('starting')
  })

  it('still refuses a second launch while one is already running', async () => {
    const { launch } = service()
    launch.simulate('running', INSTALLATION)

    const result = await launch.start({ installationId: INSTALLATION })

    // The pre-existing refusal is unchanged by the new one in front of it.
    expect(result).toEqual({ ok: false, error: { key: 'launch.error.alreadyRunning' } })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

/**
 * Story 103 D5. `plan()` is the one place a compatibility runner is applied, so these three cover
 * the three answers it can give for a Windows executable: wrapped (AC5), refused (AC7), and - the
 * one that must not have changed at all - untouched on Windows (AC8).
 */
describe('LaunchService.plan with a runner', () => {
  it('a wine plan keeps the generated args, the working directory and the array spawn form', async () => {
    restorePlatform = stubPlatform('linux')
    const { launch } = service({ installation: peInstallation, runners: [NATIVE, WINE] })

    const planned = await launch.plan({ installationId: INSTALLATION })
    if (!planned.ok) throw new Error(`expected a plan, got ${planned.error.key}`)

    // The generated command line is the one `buildLaunchArgs` produces for this installation,
    // untouched - the runner only gets prepended in front of the executable.
    const generated = buildLaunchArgs(peInstallation).args
    expect(generated).toContain('rogue')
    expect(planned.value.executablePath).toBe(WINE.path)
    expect(planned.value.args).toEqual([peInstallation.executablePath, ...generated])
    expect(planned.value.workingDirectory).toBe(peInstallation.rootPath)
    expect(planned.value.preview).toContain(WINE.path)

    spawnMock.mockImplementation(() => fakeChild() as never)
    const started = await launch.start({ installationId: INSTALLATION })

    expect(started.ok).toBe(true)
    // Array form, never a shell string, and the game's own folder as cwd.
    expect(spawnMock).toHaveBeenCalledWith(
      WINE.path,
      [peInstallation.executablePath, ...generated],
      expect.objectContaining({ cwd: peInstallation.rootPath }),
    )
    // Q2: no launcher-owned wine prefix - nothing sets `env` for the child at all.
    expect(spawnMock.mock.calls[0]?.[2]).not.toHaveProperty('env')
  })

  it('start refuses with noRunner and never spawns', async () => {
    restorePlatform = stubPlatform('linux')
    const { launch, broadcast } = service({
      installation: peInstallation,
      runners: [NATIVE, NO_WINE],
    })

    const result = await launch.start({ installationId: INSTALLATION })

    expect(result).toEqual({
      ok: false,
      error: { key: 'launch.error.noRunner', params: { executable: 'quake2.exe' } },
    })
    // The whole point of AC7: the refusal happens inside `plan()`, before `start()` enters a
    // launch state at all - so no process, and no `launch:state` traffic to unwind either.
    expect(spawnMock).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(launch.getState()).toEqual({ phase: 'idle', installationId: null })
  })

  it('win32 plan is unwrapped', async () => {
    restorePlatform = stubPlatform('win32')
    // Deliberately hostile: a PE executable *and* an available wine. Windows must ignore both.
    const { launch, detectRunners } = service({
      installation: peInstallation,
      runners: [NATIVE, WINE],
    })

    const planned = await launch.plan({ installationId: INSTALLATION })
    if (!planned.ok) throw new Error(`expected a plan, got ${planned.error.key}`)

    const generated = buildLaunchArgs(peInstallation).args
    expect(planned.value).toEqual({
      executablePath: peInstallation.executablePath,
      args: generated,
      workingDirectory: peInstallation.rootPath,
      preview: expect.stringContaining(peInstallation.executablePath as string),
    })
    // No runner detection happens on Windows at all - not even the cheap, injected one.
    expect(detectRunners).not.toHaveBeenCalled()
  })
})

/**
 * Story 104 D4. A stored Steam choice turns the launch into a handoff: `steam <url>`, detached, and
 * followed only as far as `'spawn'` - the game process belongs to Steam, so there is no exit to wait
 * for and no playtime to record.
 */
describe('LaunchService steam handoff', () => {
  const STEAM: DetectedRunner = {
    kind: 'steam',
    id: 'steam',
    path: 'C:\\Program Files (x86)\\Steam\\steam.exe',
    available: true,
  }
  const steamInstallation = {
    ...installation,
    runner: 'steam',
    steamAppId: '2320',
    steamClient: 3,
  } as unknown as Installation

  it('a steam handoff spawns detached with only the URL, reports handed-off and records no playtime', async () => {
    // win32 with no `executableKind`: exactly where `needsCompatRunner` is false, so this also
    // proves the stored choice is honoured ahead of that gate.
    restorePlatform = stubPlatform('win32')
    const installations = fakeInstallations(steamInstallation)
    const broadcast = vi.fn<(state: LaunchState) => void>()
    const launch = new LaunchService({
      installations,
      onStateChange: broadcast,
      detectRunners: () => Promise.resolve([NATIVE, STEAM]),
    })
    const child = { once: vi.fn(), unref: vi.fn(), pid: 4242 }
    spawnMock.mockImplementation(() => child as never)
    const url = steamLaunchUrl('2320', 3)

    const planned = await launch.plan({ installationId: INSTALLATION })
    if (!planned.ok) throw new Error(`expected a plan, got ${planned.error.key}`)
    expect(planned.value).toEqual({
      executablePath: STEAM.path,
      args: [url],
      workingDirectory: steamInstallation.rootPath,
      preview: expect.stringContaining(url as string),
      handoff: true,
    })
    // None of the generated `+set` arguments leak into the preview.
    expect(planned.value.preview).not.toContain('+set')

    const started = await launch.start({ installationId: INSTALLATION })

    expect(started.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith(
      STEAM.path,
      [url],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    )
    expect(child.unref).toHaveBeenCalledTimes(1)
    const events = child.once.mock.calls.map((call) => call[0] as string)
    expect(events).not.toContain('exit')

    const onSpawn = child.once.mock.calls.find((call) => call[0] === 'spawn')?.[1] as () => void
    onSpawn()

    expect(launch.getState().phase).toBe('handed-off')
    expect(launch.getState()).not.toHaveProperty('pid')
    expect(launch.isRunning()).toBe(false)
    const phases = broadcast.mock.calls.map((call) => call[0].phase)
    expect(phases).toEqual(['starting', 'handed-off'])
    expect(phases).not.toContain('running')
    expect(installations.recordPlaySession).not.toHaveBeenCalled()
  })

  it('a stored steam choice with an unlisted client index falls back to the normal launch, never wrapping steam as a runner', async () => {
    // Linux + a Windows PE: the one case where the compat branch runs, and where `resolveRunner`
    // would otherwise hand back Steam (available, known appid) to be wrapped around the exe.
    restorePlatform = stubPlatform('linux')
    const LINUX_STEAM: DetectedRunner = { kind: 'steam', id: 'steam', path: '/usr/bin/steam', available: true }
    const brokenChoice = {
      ...peInstallation,
      runner: 'steam',
      steamAppId: '2320',
      steamClient: 99,
    } as unknown as Installation
    const { launch } = service({ installation: brokenChoice, runners: [NATIVE, WINE, LINUX_STEAM] })

    const planned = await launch.plan({ installationId: INSTALLATION })
    if (!planned.ok) throw new Error(`expected a plan, got ${planned.error.key}`)

    // Exactly the plan an installation with no stored choice gets: wine around the exe.
    const generated = buildLaunchArgs(brokenChoice).args
    expect(planned.value).toEqual({
      executablePath: WINE.path,
      args: [brokenChoice.executablePath, ...generated],
      workingDirectory: brokenChoice.rootPath,
      preview: expect.stringContaining(WINE.path),
    })
    expect(planned.value).not.toHaveProperty('handoff')

    spawnMock.mockImplementation(() => fakeChild() as never)
    const started = await launch.start({ installationId: INSTALLATION })

    expect(started.ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0]?.[0]).toBe(WINE.path)
    expect(spawnMock.mock.calls.map((call) => call[0])).not.toContain(LINUX_STEAM.path)
  })
})

/**
 * Story 125 D2. A join password reaches the game only through a one-shot cfg next to the install.
 * These run against a real temp folder, because the file's lifetime is the whole point: it must
 * still be there after `spawn()` returns (a real r1q2 reads it well after that) and gone once the
 * launch is over, however it ended.
 */
describe('LaunchService join with a password', () => {
  const PASSWORD = 'hunter2-secret'
  const STEAM: DetectedRunner = {
    kind: 'steam',
    id: 'steam',
    path: 'C:\\Program Files (x86)\\Steam\\steam.exe',
    available: true,
  }
  let root: string
  let cfg: string

  const join125 = (): LaunchInput => ({
    installationId: INSTALLATION,
    connect: '1.2.3.4:27910',
    userinfo: { password: PASSWORD },
  })
  const joinInstallation = (overrides: Record<string, unknown> = {}): Installation =>
    ({ ...installation, rootPath: root, ...overrides }) as unknown as Installation
  const listener = (child: ReturnType<typeof fakeChild>, event: string): ((...args: unknown[]) => void) =>
    child.once.mock.calls.find((call) => call[0] === event)?.[1] as (...args: unknown[]) => void

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'q2l-launch-'))
    await mkdir(join(root, 'baseq2'))
    cfg = join(root, 'baseq2', CONNECT_CFG_NAME)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('a join with a password writes the connect cfg before spawn and the spawned argv never contains it', async () => {
    const { launch } = service({ installation: joinInstallation() })
    const child = fakeChild()
    let cfgAtSpawn: string | undefined
    spawnMock.mockImplementation(() => {
      cfgAtSpawn = existsSync(cfg) ? readFileSync(cfg, 'utf8') : undefined
      return child as never
    })

    const planned = await launch.plan(join125())
    const started = await launch.start(join125())

    expect(started.ok).toBe(true)
    expect(cfgAtSpawn).toBe(renderConnectCfg({ password: PASSWORD }))
    expect(cfgAtSpawn).toContain(`set password "${PASSWORD}"`)
    const argv = spawnMock.mock.calls[0]?.[1] as string[]
    expect(argv.slice(-4)).toEqual(['+exec', CONNECT_CFG_NAME, '+connect', '1.2.3.4:27910'])
    // Not in argv, not in the spawn options, not in the preview, not in any log line.
    expect(JSON.stringify(spawnMock.mock.calls)).not.toContain(PASSWORD)
    expect(JSON.stringify(planned)).not.toContain(PASSWORD)
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('launching'))
    expect(loggedText()).not.toContain(PASSWORD)

    expect(launch.getState()).toMatchObject({ phase: 'starting', connect: '1.2.3.4:27910' })
    listener(child, 'spawn')()
    expect(launch.getState()).toMatchObject({ phase: 'running', connect: '1.2.3.4:27910', pid: 4242 })
    expect(JSON.stringify(launch.getState())).not.toContain(PASSWORD)
  })

  it('the connect cfg outlives spawn and is removed on exit, on error and on spawn failure', async () => {
    // 1. exit: the file survives `spawn()` returning, the event loop turning and the `'spawn'`
    //    event - a real game reads it only once it is up - and goes with the process.
    {
      const { launch } = service({ installation: joinInstallation() })
      const child = fakeChild()
      spawnMock.mockImplementation(() => child as never)

      await launch.start(join125())
      expect(existsSync(cfg)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(cfg)).toBe(true)
      listener(child, 'spawn')()
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(cfg)).toBe(true)

      listener(child, 'exit')(0, null)
      await vi.waitFor(() => expect(existsSync(cfg)).toBe(false))
    }

    // 2. error: the process failed after spawn returned.
    {
      const { launch } = service({ installation: joinInstallation() })
      const child = fakeChild()
      spawnMock.mockImplementation(() => child as never)

      await launch.start(join125())
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(existsSync(cfg)).toBe(true)

      listener(child, 'error')(new Error('spawn r1q2.exe ENOENT'))
      await vi.waitFor(() => expect(existsSync(cfg)).toBe(false))
      expect(launch.getState().phase).toBe('failed')
    }

    // 3. spawn threw synchronously: the file was there for it, and is gone by the time
    //    `start()` reports the failure.
    {
      const { launch } = service({ installation: joinInstallation() })
      let existedAtSpawn = false
      spawnMock.mockImplementation(() => {
        existedAtSpawn = existsSync(cfg)
        throw new Error('EACCES')
      })

      const result = await launch.start(join125())

      expect(result).toEqual({
        ok: false,
        error: { key: 'launch.error.spawnFailed', params: { path: installation.executablePath } },
      })
      expect(existedAtSpawn).toBe(true)
      expect(existsSync(cfg)).toBe(false)
    }
    expect(loggedText()).not.toContain(PASSWORD)
  })

  it('a leftover connect cfg is removed before the next launch', async () => {
    // What a launcher killed mid-game leaves behind.
    await writeFile(cfg, 'set password "stale-secret"\n')
    const { launch } = service({ installation: joinInstallation() })
    let existedAtSpawn = true
    spawnMock.mockImplementation(() => {
      existedAtSpawn = existsSync(cfg)
      return fakeChild() as never
    })

    // A plain launch, not a join: the sweep does not depend on this launch needing the file.
    const result = await launch.start({ installationId: INSTALLATION })

    expect(result.ok).toBe(true)
    expect(existedAtSpawn).toBe(false)
    expect(existsSync(cfg)).toBe(false)
    expect(spawnMock.mock.calls[0]?.[1]).not.toContain('+exec')
  })

  it('an overlapping second start() is refused and cannot sweep the first one\'s cfg or orphan its cleanup', async () => {
    const { launch } = service({ installation: joinInstallation() })
    const child = fakeChild()
    let cfgAtSpawn: string | undefined
    spawnMock.mockImplementation(() => {
      cfgAtSpawn = existsSync(cfg) ? readFileSync(cfg, 'utf8') : undefined
      return child as never
    })

    // A double-clicked Join: the second call starts before the first one's sweep, plan and cfg
    // write have resolved - i.e. while `phase` is still idle.
    const first = launch.start(join125())
    const second = launch.start({ installationId: INSTALLATION })
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult.ok).toBe(true)
    expect(secondResult).toEqual({ ok: false, error: { key: 'launch.error.alreadyRunning' } })
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(cfgAtSpawn).toBe(renderConnectCfg({ password: PASSWORD }))
    // The refused call never ran its own sweep over the first call's file...
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(existsSync(cfg)).toBe(true)
    // ...nor bumped the launch sequence, so the first launch's own exit still removes it.
    listener(child, 'spawn')()
    listener(child, 'exit')(0, null)
    await vi.waitFor(() => expect(existsSync(cfg)).toBe(false))
    expect(loggedText()).not.toContain(PASSWORD)
  })

  it('spectate password never reaches argv, only the cfg carries it as spectator', async () => {
    const { launch } = service({ installation: joinInstallation() })
    const child = fakeChild()
    let cfgAtSpawn: string | undefined
    spawnMock.mockImplementation(() => {
      cfgAtSpawn = existsSync(cfg) ? readFileSync(cfg, 'utf8') : undefined
      return child as never
    })

    const started = await launch.start({
      installationId: INSTALLATION,
      connect: '1.2.3.4:27910',
      userinfo: { password: PASSWORD },
      spectate: true,
    })

    expect(started.ok).toBe(true)
    expect(cfgAtSpawn).toBe(renderConnectCfg({ spectator: PASSWORD }))
    expect(cfgAtSpawn).toContain(`set spectator "${PASSWORD}"`)
    expect(cfgAtSpawn).not.toContain('password')
    const argv = spawnMock.mock.calls[0]?.[1] as string[]
    expect(argv.join(' ')).not.toContain(PASSWORD)
    expect(argv.join(' ')).not.toContain('spectator')
  })

  it("spectate without a password writes the cfg with spectator '1'", async () => {
    const { launch } = service({ installation: joinInstallation() })
    const child = fakeChild()
    let cfgAtSpawn: string | undefined
    spawnMock.mockImplementation(() => {
      cfgAtSpawn = existsSync(cfg) ? readFileSync(cfg, 'utf8') : undefined
      return child as never
    })

    const started = await launch.start({
      installationId: INSTALLATION,
      connect: '1.2.3.4:27910',
      spectate: true,
    })

    expect(started.ok).toBe(true)
    expect(cfgAtSpawn).toBe(renderConnectCfg({ spectator: '1' }))
  })

  it('a start refused before it ran anything does not block the next one', async () => {
    const { launch, broadcast } = service({ installation: joinInstallation() })
    spawnMock.mockImplementation(() => fakeChild() as never)

    expect(await launch.start({ installationId: 'no-such-installation' })).toEqual({
      ok: false,
      error: { key: 'launch.error.notFound' },
    })
    expect(broadcast).not.toHaveBeenCalled()
    expect((await launch.start({ installationId: INSTALLATION })).ok).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('a Steam handoff refuses a connect', async () => {
    restorePlatform = stubPlatform('win32')
    const broadcast = vi.fn<(state: LaunchState) => void>()
    const launch = new LaunchService({
      installations: fakeInstallations(
        joinInstallation({ runner: 'steam', steamAppId: '2320', steamClient: 3 }),
      ),
      onStateChange: broadcast,
      detectRunners: () => Promise.resolve([NATIVE, STEAM]),
    })
    const refused = { ok: false, error: { key: 'launch.error.connectNeedsDirectLaunch' } }

    expect(await launch.plan(join125())).toEqual(refused)
    expect(await launch.start(join125())).toEqual(refused)

    expect(spawnMock).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(existsSync(cfg)).toBe(false)
    expect(loggedText()).not.toContain(PASSWORD)
    // Without a connect the same installation still hands off as before.
    expect((await launch.plan({ installationId: INSTALLATION })).ok).toBe(true)
  })
})

describe('LaunchService.onStateChange', () => {
  it('notifies observers after the broadcast, with the same state', () => {
    const { launch, broadcast } = service()
    const order: string[] = []
    broadcast.mockImplementation(() => {
      order.push('broadcast')
    })
    const observer = vi.fn<(state: LaunchState) => void>(() => {
      order.push('observer')
    })
    launch.onStateChange(observer)

    launch.simulate('running', INSTALLATION)

    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer.mock.calls[0]?.[0]).toEqual(broadcast.mock.calls[0]?.[0])
    expect(observer.mock.calls[0]?.[0]?.phase).toBe('running')
    // `launch:state` stays first and unhindered - the whole point of the observer
    // list being additive rather than a replacement of the constructor callback.
    expect(order).toEqual(['broadcast', 'observer'])
  })

  it('keeps broadcasting when an observer throws, and unsubscribes only that one', () => {
    const { launch, broadcast } = service()
    launch.onStateChange(() => {
      throw new Error('observer is broken')
    })
    const healthy = vi.fn<(state: LaunchState) => void>()
    const unsubscribe = launch.onStateChange(healthy)

    expect(() => launch.simulate('running', INSTALLATION)).not.toThrow()
    unsubscribe()
    launch.simulate('idle', INSTALLATION)

    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
