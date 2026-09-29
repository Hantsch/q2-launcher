import { describe, expect, it } from 'vitest'
import type { DiscoveredDemo } from '../modules/replays'
import { engineKindSchema } from '../schemas'
import { demoGameDir, demoPlayEligibility, type DemoPlayInput } from './demo-play'

type Inst = DemoPlayInput['installations'][number]

function inst(id: string, engineKind: Inst['engineKind'], gameDirs: string[] = [], runner?: string): Inst {
  return { id, engineKind, gameDirs, ...(runner === undefined ? {} : { runner }) }
}

function demo(over: Partial<DiscoveredDemo> = {}): DiscoveredDemo {
  return {
    id: '0123456789abcdef',
    fileName: 'match.dm2',
    format: 'dm2',
    gzip: false,
    source: { kind: 'installation', installationId: 'a', installationName: 'A', gameDir: 'baseq2' },
    archiveEntry: null,
    map: 'q2dm1',
    unparsableReason: null,
    readable: true,
    unreadable: null,
    gameDir: null,
    pov: null,
    players: [],
    durationMs: null,
    fileTime: null,
    nameFacts: null,
    ...over,
  } as DiscoveredDemo
}

function run(over: Partial<DemoPlayInput> = {}) {
  return demoPlayEligibility({
    demo: demo(),
    installations: [inst('a', 'q2pro', ['rogue'])],
    activeInstallationId: 'a',
    platform: 'win32',
    gameRunning: false,
    ...over,
  })
}

function keyOf(r: ReturnType<typeof run>): string | null {
  return r.ok ? null : r.reason.key
}

const P = 'replays.play.unavailable.'

describe('demoGameDir', () => {
  it('uses the header game dir, baseq2 for null or empty', () => {
    expect(demoGameDir(demo({ gameDir: 'rogue' }))).toBe('rogue')
    expect(demoGameDir(demo({ gameDir: null }))).toBe('baseq2')
    expect(demoGameDir(demo({ gameDir: '' }))).toBe('baseq2')
  })

  it('falls back to the source game dir when the header is unreadable', () => {
    const d = demo({
      readable: false,
      gameDir: null,
      source: { kind: 'installation', installationId: 'a', installationName: 'A', gameDir: 'xatrix' },
    })
    expect(demoGameDir(d)).toBe('xatrix')
  })
})

describe('demoPlayEligibility', () => {
  it('the active Q2PRO with the game dir plays', () => {
    const r = run({
      demo: demo({
        gameDir: 'rogue',
        source: { kind: 'installation', installationId: 'a', installationName: 'A', gameDir: 'rogue' },
      }),
    })
    expect(r).toEqual({
      ok: true,
      installationId: 'a',
      gameDir: 'rogue',
      inPlace: true,
      extraArgs: ['+demo', 'match.dm2'],
    })
  })

  it('a non-Q2PRO active installation is refused with notQ2pro even when another Q2PRO qualifies', () => {
    const r = run({ installations: [inst('a', 'r1q2'), inst('b', 'q2pro')] })
    expect(keyOf(r)).toBe(P + 'notQ2pro')
  })

  it('no installation with the game dir gives modMissing with the dir', () => {
    const r = run({ demo: demo({ gameDir: 'zaero' }) })
    expect(r).toEqual({ ok: false, reason: { key: P + 'modMissing', params: { gameDir: 'zaero' } } })
  })

  it('an active installation lacking the game dir gives modMissing even if another has it', () => {
    const r = run({
      demo: demo({ gameDir: 'rogue' }),
      installations: [inst('a', 'q2pro', []), inst('b', 'q2pro', ['rogue'])],
    })
    expect(r).toEqual({ ok: false, reason: { key: P + 'modMissing', params: { gameDir: 'rogue' } } })
  })

  it('the game dir is matched case-insensitively and baseq2 always counts as present', () => {
    const rogue = demo({
      gameDir: 'ROGUE',
      source: { kind: 'installation', installationId: 'a', installationName: 'A', gameDir: 'rogue' },
    })
    expect(run({ demo: rogue }).ok).toBe(true)
    expect(run({ installations: [inst('a', 'q2pro', [])] }).ok).toBe(true)
  })

  it('extraArgs is exactly +demo and the file name, never demomap', () => {
    const r = run({ demo: demo({ fileName: 'my-run_1.dm2.gz' }) })
    expect(r.ok && r.extraArgs).toEqual(['+demo', 'my-run_1.dm2.gz'])
    expect(JSON.stringify(r)).not.toContain('demomap')
  })

  it('an mvd2 / mvd2.gz keeps its full extension on +demo', () => {
    for (const [fileName, gzip] of [
      ['team_q2dm3.mvd2', false],
      ['tourney.mvd2.gz', true],
    ] as const) {
      const r = run({ demo: demo({ fileName, format: 'mvd2', gzip }) })
      expect(r.ok && r.inPlace, fileName).toBe(true)
      expect(r.ok && r.extraArgs, fileName).toEqual(['+demo', fileName])
    }
  })

  it('an mvd2 on an r1q2 active installation is disabled with the not-Q2PRO reason', () => {
    for (const [fileName, gzip] of [
      ['team_q2dm3.mvd2', false],
      ['tourney.mvd2.gz', true],
    ] as const) {
      const r = run({
        demo: demo({ fileName, format: 'mvd2', gzip }),
        installations: [inst('a', 'r1q2', []), inst('b', 'q2pro', [])],
      })
      expect(keyOf(r), fileName).toBe(P + 'notQ2pro')
    }
  })

  it('demo args never contain demomap, for any engine and any demo shape', () => {
    const archivedGz = demo({
      fileName: 'run.dm2.gz',
      gzip: true,
      archiveEntry: { archivePath: 'x.zip', entryPath: 'run.dm2.gz' },
    })
    for (const engineKind of engineKindSchema.options) {
      for (const d of [demo(), demo({ fileName: 'my-run_1.dm2.gz', gzip: true }), archivedGz]) {
        const r = run({ demo: d, installations: [inst('a', engineKind, [])] })
        expect(JSON.stringify(r).toLowerCase(), engineKind).not.toContain('demomap')
        // Only Q2PRO is ever eligible, so no other engine gets any launch args at all.
        expect(r.ok, engineKind).toBe(engineKind === 'q2pro')
      }
    }
  })

  it('a demo of another installation / extra folder / archive entry is playable, but not in place', () => {
    const other = demo({
      source: { kind: 'installation', installationId: 'b', installationName: 'B', gameDir: 'baseq2' },
    })
    const folder = demo({ source: { kind: 'extraFolder', path: 'D:/demos' } })
    const archived = demo({ archiveEntry: { archivePath: 'x.zip', entryPath: 'match.dm2' } })
    const wrongDir = demo({
      source: { kind: 'installation', installationId: 'a', installationName: 'A', gameDir: 'rogue' },
      gameDir: 'baseq2',
    })
    const insts = [inst('a', 'q2pro', ['rogue']), inst('b', 'q2pro')]
    for (const d of [other, folder, archived, wrongDir]) {
      expect(run({ demo: d, installations: insts })).toEqual({
        ok: true,
        installationId: 'a',
        gameDir: 'baseq2',
        inPlace: false,
        extraArgs: [],
      })
    }
  })

  it('a demo of another installation still obeys the engine, mod, runner and running rules', () => {
    const other = demo({
      source: { kind: 'installation', installationId: 'b', installationName: 'B', gameDir: 'baseq2' },
    })
    expect(keyOf(run({ demo: other, installations: [inst('a', 'r1q2')] }))).toBe(P + 'notQ2pro')
    expect(keyOf(run({ demo: { ...other, gameDir: 'zaero' }, installations: [inst('a', 'q2pro')] }))).toBe(
      P + 'modMissing',
    )
    expect(keyOf(run({ demo: other, installations: [inst('a', 'q2pro', [], 'steam')] }))).toBe(
      P + 'needsDirectLaunch',
    )
    expect(keyOf(run({ demo: other, gameRunning: true }))).toBe(P + 'gameRunning')
  })

  it('a demo found under a different game dir than its own or baseq2 is playable, but not in place', () => {
    const d = demo({
      gameDir: 'rogue',
      source: { kind: 'installation', installationId: 'a', installationName: 'A', gameDir: 'xatrix' },
    })
    const r = run({ demo: d, installations: [inst('a', 'q2pro', ['rogue', 'xatrix'])] })
    expect(r.ok && r.inPlace).toBe(false)
  })

  it('linux without any Q2PRO gives linuxNoQ2pro', () => {
    const r = run({ platform: 'linux', installations: [inst('a', 'r1q2')] })
    expect(keyOf(r)).toBe(P + 'linuxNoQ2pro')
  })

  it('linux with a Q2PRO plays', () => {
    expect(run({ platform: 'linux' }).ok).toBe(true)
  })

  it('no active installation gives notQ2pro', () => {
    expect(keyOf(run({ activeInstallationId: null }))).toBe(P + 'notQ2pro')
  })

  it('an active installation launching through Steam gives needsDirectLaunch', () => {
    const r = run({ installations: [inst('a', 'q2pro', [], 'steam')] })
    expect(keyOf(r)).toBe(P + 'needsDirectLaunch')
  })

  it('a running game gives gameRunning', () => {
    expect(keyOf(run({ gameRunning: true }))).toBe(P + 'gameRunning')
  })

  it('names containing ; a space or + are never put on the console: playable only via a copy', () => {
    for (const fileName of ['a;quit.dm2', 'my demo.dm2', 'a+quit.dm2']) {
      const r = run({ demo: demo({ fileName }) })
      expect(r.ok && r.inPlace).toBe(false)
      expect(r.ok && r.extraArgs).toEqual([])
    }
  })

  it('reasons are reported in the fixed order', () => {
    const bad = demo({ gameDir: 'zaero', fileName: 'a b.dm2' })
    expect(keyOf(run({ demo: bad, platform: 'linux', installations: [inst('a', 'r1q2')] }))).toBe(
      P + 'linuxNoQ2pro',
    )
    expect(keyOf(run({ demo: bad, installations: [inst('a', 'r1q2')] }))).toBe(P + 'modMissing')
    expect(keyOf(run({ gameRunning: true, installations: [inst('a', 'q2pro', [], 'steam')] }))).toBe(
      P + 'needsDirectLaunch',
    )
  })
})
