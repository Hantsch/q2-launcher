import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type LaunchInput } from '@shared/types'
import { SESSION_RESTORE_CVARS } from './demo-play'
import { stageLaunchArgs } from './stage'
import { LAUNCHER_DIR_NAME } from './demo-staging'
import { createCvarRestore } from './session-cvar-restore'
import { limitsFor } from '@shared/config/syntax/engine-limits'
import {
  BASE_DEMO,
  ctfFiles,
  demo,
  fakeControl,
  harness,
  q2proRoot,
  r1q2Root,
  setupDirs,
  siblingRoot,
  teardownDirs,
  tmp,
  type Setup,
} from './demo-play.test-helpers'

beforeEach(setupDirs)
afterEach(teardownDirs)

describe('demo.play session volume', () => {
  const configPath = (): string => join(q2proRoot, 'baseq2', 'q2config.cfg')
  const argsOf = (h: ReturnType<typeof harness>): string[] =>
    (h.launch.start.mock.calls[0] as unknown as [LaunchInput])[0].extraArgs ?? []
  /** The three args right before `+demo`. */
  const beforeDemo = (h: ReturnType<typeof harness>): string[] => {
    const args = argsOf(h)
    const at = args.indexOf('+demo')
    return args.slice(at - 3, at)
  }

  it('a play launches with +set s_volume at the remembered volume', async () => {
    await writeFile(configPath(), 'seta s_volume "0.2"\n')
    const playback = fakeControl()
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback, demoVolume: 40 })
    expect((await h.play('base', 'q2pro-a')).ok).toBe(true)
    expect(beforeDemo(h)).toEqual(['+set', 's_volume', '0.4'])
    expect(playback.prepare).toHaveBeenCalledWith(expect.objectContaining({ volumePercent: 40 }))
  })

  it("without a remembered volume it starts at the config's s_volume, else 0.7", async () => {
    // The engine execs its config top to bottom, so the last line is the game's own level.
    await writeFile(configPath(), 'seta s_volume "0.2"\r\nset s_volume "0.35"\r\n')
    const fromConfig = fakeControl()
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback: fromConfig })
    expect((await h.play('base', 'q2pro-a')).ok).toBe(true)
    expect(beforeDemo(h)).toEqual(['+set', 's_volume', '0.35'])
    expect(fromConfig.prepare).toHaveBeenCalledWith(expect.objectContaining({ volumePercent: 35 }))

    await rm(configPath())
    const fresh = fakeControl()
    const first = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback: fresh })
    expect((await first.play('base', 'q2pro-a')).ok).toBe(true)
    expect(beforeDemo(first)).toEqual(['+set', 's_volume', '0.7'])
    expect(fresh.prepare).toHaveBeenCalledWith(expect.objectContaining({ volumePercent: 70 }))
  })

  it("s_volume's archived line is restored after the game exits (also when nothing was remembered)", async () => {
    const elsewhere = demo({
      id: 'away',
      fileName: 'evil.dm2',
      source: {
        kind: 'installation',
        installationId: 'q2pro-other',
        installationName: 'Other',
        gameDir: 'baseq2',
      },
    })
    const cases = [
      {
        path: 'in place',
        demoId: 'base',
        demos: [BASE_DEMO],
        remembered: null,
        before: 'set name "p"\nseta s_volume "0.3"\n',
      },
      {
        path: 'staged copy',
        demoId: 'away',
        demos: [elsewhere],
        remembered: 60,
        before: 'set name "p"\n',
      },
    ]
    for (const c of cases) {
      await writeFile(configPath(), c.before)
      const real = createCvarRestore({
        names: SESSION_RESTORE_CVARS,
        pendingPath: join(tmp, `pending-${c.demoId}.json`),
      })
      let restored: Promise<void> = Promise.resolve()
      const cvarRestore = { snapshot: real.snapshot, restore: () => (restored = real.restore()) }
      const h = harness({
        demos: c.demos,
        files: {
          ...ctfFiles(),
          away: {
            absolutePath: join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'),
            archiveEntry: null,
          },
        },
        playback: fakeControl(),
        cvarRestore,
        demoVolume: c.remembered,
      })
      expect((await h.play(c.demoId, 'q2pro-a')).ok, c.path).toBe(true)
      // On its way out the game archives the level the user left it at.
      await writeFile(configPath(), 'set name "p"\nseta s_volume "0.9"\n')
      h.emit({ phase: 'exited', installationId: 'q2pro-a' })
      await restored
      expect(await readFile(configPath(), 'latin1'), c.path).toBe(c.before)
    }
  })
})

describe('demo.play in an R1Q2 installation', () => {
  const STAGE = { x: 1, y: 2, width: 640, height: 360 }
  const R1Q2_DEMO = demo({
    id: 'r',
    fileName: 'r.dm2',
    protocol: 34,
    source: {
      kind: 'installation',
      installationId: 'r1q2-b',
      installationName: 'R1Q2',
      gameDir: 'baseq2',
    },
  })
  const r1q2Files = (): Setup['files'] => ({
    ...ctfFiles(),
    r: { absolutePath: join(r1q2Root, 'baseq2', 'demos', 'r.dm2'), archiveEntry: null },
  })
  const r1q2Config = (): string =>
    join(r1q2Root, 'baseq2', limitsFor('r1q2')?.writtenConfigName ?? 'unknown')
  const restorer = () => ({
    snapshot: vi.fn(async (_configPath: string, _options?: { wholeFile?: true }) => undefined),
    restore: vi.fn(async () => undefined),
  })
  const startOf = (h: ReturnType<typeof harness>): [LaunchInput, unknown] =>
    h.launch.start.mock.calls[0] as unknown as [LaunchInput, unknown]
  const ORIGINAL = Buffer.from('bind x "say hi"\r\nset name "me"', 'latin1')

  it('an r1q2 demo in place launches r1q2 with exactly +demomap and the file', async () => {
    for (const platform of ['win32', 'linux']) {
      const h = harness({ demos: [R1Q2_DEMO], files: r1q2Files(), active: 'r1q2-b', platform })
      expect(await h.play('r', 'r1q2-b'), platform).toEqual({ ok: true, value: { stage: null } })
      const [input, options] = startOf(h)
      expect(input, platform).toEqual({
        installationId: 'r1q2-b',
        gameDir: 'baseq2',
        extraArgs: ['+demomap', 'r.dm2'],
      })
      expect(options, platform).toEqual({ demo: true })
      expect(h.sessions.begin, platform).toHaveBeenCalledWith('r')
    }
  })

  it('an r1q2 demo from elsewhere plays its staged copy with +demomap', async () => {
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), active: 'r1q2-b' })
    expect((await h.play('base', 'r1q2-b')).ok).toBe(true)
    const [input] = startOf(h)
    const args = input.extraArgs ?? []
    expect(args).toHaveLength(2)
    expect(args[0]).toBe('+demomap')
    expect(args[1]?.startsWith(`${LAUNCHER_DIR_NAME}/`)).toBe(true)
    const copy = join(r1q2Root, 'baseq2', 'demos', args[1] ?? '')
    expect(existsSync(copy)).toBe(true)
    h.emit({ phase: 'exited', installationId: 'r1q2-b' })
    await vi.waitFor(() => expect(existsSync(copy)).toBe(false))
  })

  it('an r1q2 launch carries no channel, volume or stage args and refuses the stage with the r1q2 reason', async () => {
    for (const platform of ['win32', 'linux']) {
      const playback = fakeControl()
      const onStageSession = vi.fn(() => () => undefined)
      const h = harness({
        demos: [R1Q2_DEMO],
        files: r1q2Files(),
        active: 'r1q2-b',
        platform,
        playback,
        onStageSession,
        demoVolume: 40,
      })
      expect(await h.play('r', 'r1q2-b', { stage: STAGE }), platform).toEqual({
        ok: true,
        value: { stage: { ok: false, reasonKey: 'replays.stage.unavailable.r1q2' } },
      })
      expect(playback.prepare, platform).toHaveBeenCalledWith({
        gameDirPath: join(r1q2Root, 'baseq2'),
        durationMs: R1Q2_DEMO.durationMs,
        format: 'dm2',
        engine: 'r1q2',
      })
      const [input, options] = startOf(h)
      expect(input.extraArgs, platform).toEqual(['+demomap', 'r.dm2'])
      // Never piped: the engine-less session has nothing to read or write.
      expect(options, platform).toEqual({ demo: true })
      expect(playback.attach, platform).toHaveBeenCalledWith(undefined)
      expect(onStageSession, platform).not.toHaveBeenCalled()
    }
  })

  it('an r1q2 launch snapshots the whole config before spawn and restores it once the game ends', async () => {
    const cvarRestore = restorer()
    const h = harness({ demos: [R1Q2_DEMO], files: r1q2Files(), active: 'r1q2-b', cvarRestore })
    expect((await h.play('r', 'r1q2-b')).ok).toBe(true)
    expect(cvarRestore.snapshot.mock.calls).toEqual([[r1q2Config(), { wholeFile: true }]])
    expect(cvarRestore.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      h.launch.start.mock.invocationCallOrder[0] ?? 0,
    )
    expect(cvarRestore.restore).not.toHaveBeenCalled()
    h.emit({ phase: 'exited', installationId: 'q2pro-other' })
    expect(cvarRestore.restore).not.toHaveBeenCalled()
    h.emit({ phase: 'exited', installationId: 'r1q2-b' })
    h.emit({ phase: 'exited', installationId: 'r1q2-b' })
    expect(cvarRestore.restore).toHaveBeenCalledTimes(1)
  })

  it('an r1q2 launch that never starts or throws still puts the config back', async () => {
    for (const failure of ['refused', 'thrown'] as const) {
      await writeFile(r1q2Config(), ORIGINAL)
      const pendingPath = join(tmp, 'userData', `${failure}.pending.json`)
      const cvarRestore = createCvarRestore({ names: [], pendingPath })
      const h = harness({ demos: [R1Q2_DEMO], files: r1q2Files(), active: 'r1q2-b', cvarRestore })
      h.launch.start.mockImplementationOnce(async () => {
        // The process got far enough to rewrite its config before the launch gave up.
        await writeFile(r1q2Config(), 'bind x "kill"\n')
        if (failure === 'thrown') throw new Error('spawn failed')
        return { ok: false, error: { key: 'launch.error.x' } } as never
      })
      if (failure === 'thrown') await expect(h.play('r', 'r1q2-b')).rejects.toThrow('spawn failed')
      else expect((await h.play('r', 'r1q2-b')).ok, failure).toBe(false)
      expect((await readFile(r1q2Config())).equals(ORIGINAL), failure).toBe(true)
      expect(existsSync(pendingPath), failure).toBe(false)
    }
  })

  it('a crashed r1q2 session puts the config back byte for byte', async () => {
    await writeFile(r1q2Config(), ORIGINAL)
    const pendingPath = join(tmp, 'userData', 'crash.pending.json')
    const cvarRestore = createCvarRestore({ names: [], pendingPath })
    const h = harness({ demos: [R1Q2_DEMO], files: r1q2Files(), active: 'r1q2-b', cvarRestore })
    expect((await h.play('r', 'r1q2-b')).ok).toBe(true)
    expect(existsSync(pendingPath)).toBe(true)
    await writeFile(r1q2Config(), 'bind x "kill"\nset cl_maxfps "999"\n')
    h.emit({ phase: 'failed', installationId: 'r1q2-b', error: { key: 'launch.error.x' } } as never)
    await vi.waitFor(() => expect(existsSync(pendingPath)).toBe(false))
    expect((await readFile(r1q2Config())).equals(ORIGINAL)).toBe(true)
  })

  it('a Q2PRO launch is unchanged', async () => {
    const playback = fakeControl()
    const cvarRestore = restorer()
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback, cvarRestore })
    expect((await h.play('base', 'q2pro-a', { stage: STAGE })).ok).toBe(true)
    expect(playback.prepare).toHaveBeenCalledWith({
      gameDirPath: join(q2proRoot, 'baseq2'),
      durationMs: BASE_DEMO.durationMs,
      format: 'dm2',
      volumePercent: 70,
    })
    const [input, options] = startOf(h)
    expect(input.extraArgs).toEqual([
      '+before',
      '+set',
      's_volume',
      '0.7',
      ...stageLaunchArgs('800x600+10+20'),
      '+demo',
      'b.dm2',
      '+exec',
      'after.cfg',
    ])
    expect(options).toEqual({ demo: true })
    // Line-wise: the snapshot carries no whole-file option.
    expect(cvarRestore.snapshot.mock.calls).toEqual([[join(q2proRoot, 'baseq2', 'q2config.cfg')]])
  })
})
