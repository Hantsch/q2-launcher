import { describe, expect, it } from 'vitest'
import type { DiscoveredDemo } from '../modules/replays'
import { engineKindSchema } from '../schemas'
import {
  demoGameDir,
  demoPlayEligibility,
  type DemoPlayEligibility,
  type DemoPlayInput,
} from './demo-play'

type Inst = DemoPlayInput['installations'][number]

function inst(
  id: string,
  engineKind: Inst['engineKind'],
  gameDirs: string[] = [],
  runner?: string,
): Inst {
  return { id, engineKind, gameDirs, checks: [], ...(runner === undefined ? {} : { runner }) }
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

function run(over: Partial<Omit<DemoPlayInput, 'mode'>> = {}) {
  return demoPlayEligibility({
    demo: demo(),
    mode: 'engine',
    installations: [inst('a', 'q2pro', ['rogue'])],
    activeInstallationId: 'a',
    platform: 'win32',
    gameRunning: false,
    ...over,
  })
}

function runIntegrated(over: Partial<Omit<DemoPlayInput, 'mode'>> = {}) {
  return demoPlayEligibility({
    demo: demo(),
    mode: 'integrated',
    installations: [inst('a', 'q2pro', ['rogue'])],
    activeInstallationId: 'a',
    platform: 'win32',
    gameRunning: false,
    ...over,
  })
}

function keyOf(r: DemoPlayEligibility): string | null {
  return r.ok ? null : r.reasonKey
}

const P = 'replays.play.unavailable.'
const PLAYER = 'replays.player.unavailable.'

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
      source: {
        kind: 'installation',
        installationId: 'a',
        installationName: 'A',
        gameDir: 'xatrix',
      },
    })
    expect(demoGameDir(d)).toBe('xatrix')
  })
})

describe('demoPlayEligibility', () => {
  it('the active Q2PRO with the game dir plays', () => {
    const r = run({
      demo: demo({
        gameDir: 'rogue',
        source: {
          kind: 'installation',
          installationId: 'a',
          installationName: 'A',
          gameDir: 'rogue',
        },
      }),
    })
    expect(r).toEqual({
      ok: true,
      mode: 'engine',
      installationId: 'a',
      gameDir: 'rogue',
      inPlace: true,
      playEngine: 'q2pro',
      extraArgs: ['+demo', 'match.dm2'],
    })
  })

  it('an active installation with neither engine is refused even when another Q2PRO qualifies', () => {
    const r = run({ installations: [inst('a', 'vanilla'), inst('b', 'q2pro')] })
    expect(keyOf(r)).toBe(P + 'unsupportedEngine')
  })

  it('an r1q2 installation with a detected Q2PRO still plays through Q2PRO', () => {
    const r = run({
      installations: [
        {
          ...inst('a', 'r1q2'),
          detectedEngines: [
            {
              kind: 'q2pro',
              executablePath: 'q2pro.exe',
              executablePaths: ['q2pro.exe'],
              supported: true,
            },
          ],
        },
      ],
    })
    expect(r).toMatchObject({ ok: true, installationId: 'a', engine: 'q2pro' })
    expect(run().ok && 'engine' in run()).toBe(false)
  })

  it('an r1q2-only installation plays through r1q2 with demomap', () => {
    const r = run({ installations: [inst('a', 'r1q2')] })
    expect(r).toEqual({
      ok: true,
      mode: 'engine',
      installationId: 'a',
      gameDir: 'baseq2',
      inPlace: true,
      playEngine: 'r1q2',
      extraArgs: ['+demomap', 'match.dm2'],
    })
  })

  it('an installation with a detected r1q2 plays through it with an engine override', () => {
    const detected = [
      {
        kind: 'r1q2' as const,
        executablePath: 'r.exe',
        executablePaths: ['r.exe'],
        supported: true,
      },
    ]
    const r = run({ installations: [{ ...inst('a', 'vanilla'), detectedEngines: detected }] })
    expect(r).toMatchObject({ ok: true, playEngine: 'r1q2', engine: 'r1q2' })
  })

  it('an unsupported detected engine on a non-capable installation is refused', () => {
    const unsupported = [
      {
        kind: 'r1q2' as const,
        executablePath: 'r.exe',
        executablePaths: ['r.exe'],
        supported: false,
      },
    ]
    expect(
      keyOf(run({ installations: [{ ...inst('a', 'vanilla'), detectedEngines: unsupported }] })),
    ).toBe(P + 'unsupportedEngine')
  })

  it('r1q2 refuses mvd2, gz and a protocol other than 34 or 35 with its own reason, and plays 34 and 35', () => {
    const insts = [inst('a', 'r1q2')]
    const refused = [
      demo({ fileName: 't.mvd2', format: 'mvd2' }),
      demo({ fileName: 't.dm2.gz', gzip: true }),
      demo({ protocol: 26 }),
      demo({
        readable: false,
        unreadable: { reason: 'unreadable', protocol: 36 },
        gameDir: null,
      } as Partial<DiscoveredDemo>),
    ]
    for (const d of refused) {
      expect(keyOf(run({ demo: d, installations: insts }))).toBe(P + 'r1q2CannotPlay')
    }
    for (const protocol of [34, 35]) {
      expect(run({ demo: demo({ protocol }), installations: insts }).ok, String(protocol)).toBe(
        true,
      )
    }
  })

  it('an unknown protocol is tried in r1q2', () => {
    expect(run({ demo: demo({ protocol: null }), installations: [inst('a', 'r1q2')] }).ok).toBe(
      true,
    )
    expect(run({ demo: demo(), installations: [inst('a', 'r1q2')] }).ok).toBe(true)
  })

  it('the mod-missing warning, a running game and a Steam runner apply to r1q2 as to Q2PRO', () => {
    const r1q2 = (runner?: string) => [inst('a', 'r1q2', [], runner)]
    expect(keyOf(run({ demo: demo({ gameDir: 'zaero' }), installations: r1q2() }))).toBe(
      P + 'modMissing',
    )
    expect(keyOf(run({ installations: r1q2('steam') }))).toBe(P + 'needsDirectLaunch')
    expect(keyOf(run({ installations: r1q2(), gameRunning: true }))).toBe(P + 'gameRunning')
  })

  it('no installation with the game dir gives an acknowledgeable modMissing warning with the dir', () => {
    const r = run({ demo: demo({ gameDir: 'zaero' }) })
    expect(r).toEqual({
      ok: false,
      reasonKey: P + 'modMissing',
      params: { gameDir: 'zaero' },
      acknowledgeable: true,
    })
  })

  it('an active installation lacking the game dir warns even if another has it', () => {
    const r = run({
      demo: demo({ gameDir: 'rogue' }),
      installations: [inst('a', 'q2pro', []), inst('b', 'q2pro', ['rogue'])],
    })
    expect(r).toEqual({
      ok: false,
      reasonKey: P + 'modMissing',
      params: { gameDir: 'rogue' },
      acknowledgeable: true,
    })
  })

  it('an acknowledged modMissing warning plays', () => {
    const r = run({ demo: demo({ gameDir: 'zaero' }), acknowledgeModMissing: true })
    expect(r.ok && r.gameDir).toBe('zaero')
  })

  it('the acknowledgement never lifts any other refusal', () => {
    expect(keyOf(run({ gameRunning: true, acknowledgeModMissing: true }))).toBe(P + 'gameRunning')
    expect(keyOf(run({ installations: [inst('a', 'vanilla')], acknowledgeModMissing: true }))).toBe(
      P + 'unsupportedEngine',
    )
  })

  it('the game dir is matched case-insensitively and baseq2 always counts as present', () => {
    const rogue = demo({
      gameDir: 'ROGUE',
      source: {
        kind: 'installation',
        installationId: 'a',
        installationName: 'A',
        gameDir: 'rogue',
      },
    })
    expect(run({ demo: rogue }).ok).toBe(true)
    expect(run({ installations: [inst('a', 'q2pro', [])] }).ok).toBe(true)
  })

  it('in-place extraArgs are +demo and the file name on Q2PRO', () => {
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

  it('a Q2PRO-played demo never gets demomap', () => {
    const archivedGz = demo({
      fileName: 'run.dm2.gz',
      gzip: true,
      archiveEntry: { archivePath: 'x.zip', entryPath: 'run.dm2.gz' },
    })
    const detected = [
      {
        kind: 'q2pro' as const,
        executablePath: 'q.exe',
        executablePaths: ['q.exe'],
        supported: true,
      },
    ]
    for (const engineKind of engineKindSchema.options) {
      for (const d of [demo(), demo({ fileName: 'my-run_1.dm2.gz', gzip: true }), archivedGz]) {
        const r = run({
          demo: d,
          installations: [{ ...inst('a', engineKind, []), detectedEngines: detected }],
        })
        expect(r.ok, engineKind).toBe(true)
        expect(JSON.stringify(r).toLowerCase(), engineKind).not.toContain('demomap')
      }
    }
  })

  it('a demo of another installation / extra folder / archive entry is playable, but not in place', () => {
    const other = demo({
      source: {
        kind: 'installation',
        installationId: 'b',
        installationName: 'B',
        gameDir: 'baseq2',
      },
    })
    const folder = demo({ source: { kind: 'extraFolder', path: 'D:/demos' } })
    const archived = demo({ archiveEntry: { archivePath: 'x.zip', entryPath: 'match.dm2' } })
    const wrongDir = demo({
      source: {
        kind: 'installation',
        installationId: 'a',
        installationName: 'A',
        gameDir: 'rogue',
      },
      gameDir: 'baseq2',
    })
    const insts = [inst('a', 'q2pro', ['rogue']), inst('b', 'q2pro')]
    for (const d of [other, folder, archived, wrongDir]) {
      expect(run({ demo: d, installations: insts })).toEqual({
        ok: true,
        mode: 'engine',
        installationId: 'a',
        gameDir: 'baseq2',
        inPlace: false,
        playEngine: 'q2pro',
        extraArgs: [],
      })
    }
  })

  it('a demo of another installation still obeys the engine, mod, runner and running rules', () => {
    const other = demo({
      source: {
        kind: 'installation',
        installationId: 'b',
        installationName: 'B',
        gameDir: 'baseq2',
      },
    })
    expect(keyOf(run({ demo: other, installations: [inst('a', 'vanilla')] }))).toBe(
      P + 'unsupportedEngine',
    )
    expect(
      keyOf(run({ demo: { ...other, gameDir: 'zaero' }, installations: [inst('a', 'q2pro')] })),
    ).toBe(P + 'modMissing')
    expect(keyOf(run({ demo: other, installations: [inst('a', 'q2pro', [], 'steam')] }))).toBe(
      P + 'needsDirectLaunch',
    )
    expect(keyOf(run({ demo: other, gameRunning: true }))).toBe(P + 'gameRunning')
  })

  it('a demo found under a different game dir than its own or baseq2 is playable, but not in place', () => {
    const d = demo({
      gameDir: 'rogue',
      source: {
        kind: 'installation',
        installationId: 'a',
        installationName: 'A',
        gameDir: 'xatrix',
      },
    })
    const r = run({ demo: d, installations: [inst('a', 'q2pro', ['rogue', 'xatrix'])] })
    expect(r.ok && r.inPlace).toBe(false)
  })

  it('linux follows the windows rule', () => {
    expect(run({ platform: 'linux', installations: [inst('a', 'r1q2')] }).ok).toBe(true)
    expect(keyOf(run({ platform: 'linux', installations: [inst('a', 'vanilla')] }))).toBe(
      P + 'unsupportedEngine',
    )
  })

  it('linux with a Q2PRO plays', () => {
    expect(run({ platform: 'linux' }).ok).toBe(true)
  })

  it('no active installation gives unsupportedEngine', () => {
    expect(keyOf(run({ activeInstallationId: null }))).toBe(P + 'unsupportedEngine')
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
    expect(keyOf(run({ demo: bad, installations: [inst('a', 'vanilla')] }))).toBe(
      P + 'unsupportedEngine',
    )
    expect(
      keyOf(
        run({ demo: bad, gameRunning: true, installations: [inst('a', 'q2pro', [], 'steam')] }),
      ),
    ).toBe(P + 'needsDirectLaunch')
    expect(keyOf(run({ demo: bad, gameRunning: true }))).toBe(P + 'gameRunning')
    expect(keyOf(run({ demo: bad }))).toBe(P + 'modMissing')
  })
})

function failing(id: Inst['checks'][number]['id'], severity: 'error' | 'warn' = 'error') {
  return { id, severity, messageKey: 'validation.x' } as const
}

describe('integrated playback eligibility', () => {
  it('integrated mode plays on an R1Q2-only or engine-less installation that has baseq2 paks', () => {
    for (const engineKind of ['r1q2', 'vanilla', 'unknown'] as const) {
      const installations = [inst('a', engineKind)]
      expect(runIntegrated({ installations }), engineKind).toEqual({
        ok: true,
        mode: 'integrated',
        installationId: 'a',
        gameDir: 'baseq2',
      })
    }
    // Engine mode keeps refusing what it cannot launch.
    expect(keyOf(run({ installations: [inst('a', 'vanilla')] }))).toBe(P + 'unsupportedEngine')
    // A gzipped demo or a protocol R1Q2 cannot play is no reason in integrated mode.
    const r1q2 = [inst('a', 'r1q2')]
    for (const d of [demo({ gzip: true, fileName: 'a.dm2.gz' }), demo({ protocol: 26 })]) {
      expect(runIntegrated({ demo: d, installations: r1q2 }).ok).toBe(true)
      expect(keyOf(run({ demo: d, installations: r1q2 }))).toBe(P + 'r1q2CannotPlay')
    }
  })

  it('integrated mode refuses an mvd2 and an mvd2.gz with the engine-mode reason', () => {
    for (const [fileName, gzip] of [
      ['team.mvd2', false],
      ['team.mvd2.gz', true],
    ] as const) {
      const d = demo({ fileName, format: 'mvd2', gzip })
      expect(runIntegrated({ demo: d }), fileName).toEqual({
        ok: false,
        reasonKey: PLAYER + 'mvd2Integrated',
      })
      expect(run({ demo: d }).ok, fileName).toBe(true)
    }
  })

  it('integrated mode refuses an installation whose base paks are missing', () => {
    for (const id of ['root-exists', 'base-game-dir', 'base-paks'] as const) {
      const installations = [{ ...inst('a', 'q2pro'), checks: [failing(id)] }]
      expect(keyOf(runIntegrated({ installations })), id).toBe(PLAYER + 'noBasePaks')
    }
    expect(keyOf(runIntegrated({ activeInstallationId: null }))).toBe(PLAYER + 'noBasePaks')
    expect(keyOf(runIntegrated({ activeInstallationId: 'gone' }))).toBe(PLAYER + 'noBasePaks')
    // Only an error on a base game check counts.
    const unaffected = [
      { ...inst('a', 'q2pro'), checks: [failing('base-paks', 'warn'), failing('executable')] },
    ]
    expect(runIntegrated({ installations: unaffected }).ok).toBe(true)
  })

  it('integrated mode ignores the Steam runner but still refuses a running game and warns on a missing mod', () => {
    const steam = [inst('a', 'q2pro', [], 'steam')]
    expect(runIntegrated({ installations: steam }).ok).toBe(true)
    expect(keyOf(run({ installations: steam }))).toBe(P + 'needsDirectLaunch')
    expect(keyOf(runIntegrated({ gameRunning: true }))).toBe(P + 'gameRunning')
    expect(runIntegrated({ demo: demo({ gameDir: 'zaero' }) })).toEqual({
      ok: false,
      reasonKey: P + 'modMissing',
      params: { gameDir: 'zaero' },
      acknowledgeable: true,
    })
    expect(
      runIntegrated({ demo: demo({ gameDir: 'zaero' }), acknowledgeModMissing: true }),
    ).toEqual({ ok: true, mode: 'integrated', installationId: 'a', gameDir: 'zaero' })
  })

  it('integrated reasons are reported in the fixed order', () => {
    const bad = demo({ gameDir: 'zaero', format: 'mvd2', fileName: 'a.mvd2' })
    const noPaks = [{ ...inst('a', 'vanilla', [], 'steam'), checks: [failing('base-paks')] }]
    expect(keyOf(runIntegrated({ demo: bad, gameRunning: true, installations: noPaks }))).toBe(
      PLAYER + 'noBasePaks',
    )
    expect(keyOf(runIntegrated({ demo: bad, gameRunning: true }))).toBe(P + 'gameRunning')
    expect(keyOf(runIntegrated({ demo: bad, acknowledgeModMissing: true }))).toBe(
      PLAYER + 'mvd2Integrated',
    )
    expect(keyOf(runIntegrated({ demo: bad }))).toBe(PLAYER + 'mvd2Integrated')
    expect(keyOf(runIntegrated({ demo: demo({ gameDir: 'zaero' }) }))).toBe(P + 'modMissing')
  })
})
