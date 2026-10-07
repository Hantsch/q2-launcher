import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { encodeLatin1 } from '../servers/protocol'
import { createDm2FrameCounter } from './dm2-frames'
import { buildDm2Stream, dm2Msg } from './dm2-frames-writer'
import type { Dm2StreamMessage } from './dm2-frames-writer'
import { ORIGINAL_LAYOUT } from './dm2-header'
import { createDm2RosterCollector } from './dm2-roster'
import type { DemoRoster } from './dm2-roster'

const FIXTURES = resolve(__dirname, '../../../docs/fixtures/demos')
const OPENTDM_EXAMPLE = 'shad-maq_PFDE3_q2rdm2_20260922-161521.dm2'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, name)))
}

/** One full frame-count pass with the roster collector observing it. */
function rosterOf(bytes: Uint8Array): DemoRoster | null {
  const collector = createDm2RosterCollector()
  const counter = createDm2FrameCounter(collector)
  counter.push(bytes)
  expect(counter.finish().ok).toBe(true)
  return collector.finish()
}

const { CS_PLAYERSKINS, MAX_CLIENTS } = ORIGINAL_LAYOUT
const skinAt = (slot: number): number => CS_PLAYERSKINS + slot
const slotStringAt = (slot: number): number => CS_PLAYERSKINS + 2 * MAX_CLIENTS + slot
const CS_STATUSBAR = 5

const layout = (text: string): Dm2StreamMessage => dm2Msg.raw(4, [...encodeLatin1(text), 0])

/** A protocol-34 demo: `header` configstrings, then each block of `blocks` followed by a frame. */
function demo(header: Record<number, string>, blocks: Dm2StreamMessage[][] = []): Uint8Array {
  return buildDm2Stream({
    protocol: 34,
    headerConfigstrings: header,
    blocks: [...blocks, []].map((block, i) => [...block, dm2Msg.frame(i + 1)]),
    terminate: true,
  })
}

describe('createDm2RosterCollector', () => {
  it('the OpenTDM example puts maq in Home and shad in Away and no spectator on a team', () => {
    const roster = rosterOf(fixture(OPENTDM_EXAMPLE))

    // Home is listed first although Away's shad holds the lower slot: the statusbar decides.
    expect(roster?.teams).toEqual([
      { name: 'Home', players: ['maq'] },
      { name: 'Away', players: ['shad'] },
    ])
    expect(roster?.spectators).toEqual(
      expect.arrayContaining(['HIMMO', 'piu-afk', 'B100D', 'damz.']),
    )
    const onTeams = roster!.teams.flatMap((team) => team.players)
    expect(roster!.spectators.filter((name) => onTeams.includes(name))).toEqual([])
    expect(onTeams).not.toContain('HIMMO')
  })

  it('test.dm2 puts sd.kgm/sauDove in Home and WallFly in the spectators', () => {
    expect(rosterOf(fixture('test.dm2'))).toEqual({
      teams: [{ name: 'Home', players: ['sd.kgm/sauDove'] }],
      spectators: ['WallFly[BZZZ]'],
    })
  })

  it('a team renamed during the match shows its final name', () => {
    const bytes = demo(
      {
        [CS_STATUSBAR]: 'xr -32 string "Home" xr -32 string "Away"',
        [skinAt(0)]: 'a\\male/grunt',
        [skinAt(1)]: 'b\\female/athena',
        [slotStringAt(0)]: 'a (Home)',
        [slotStringAt(1)]: 'b (Away)',
      },
      [
        [
          dm2Msg.configstring(slotStringAt(0), 'a (Lions)'),
          dm2Msg.configstring(CS_STATUSBAR, 'xr -32 string "Lions" xr -32 string "Away"'),
        ],
      ],
    )
    expect(rosterOf(bytes)).toEqual({
      teams: [
        { name: 'Lions', players: ['a'] },
        { name: 'Away', players: ['b'] },
      ],
      spectators: [],
    })
  })

  it('a duel without team strings has no roster', () => {
    const bytes = demo({
      [skinAt(0)]: 'a\\male/grunt',
      [skinAt(1)]: 'b\\female/athena',
      [slotStringAt(0)]: 'a',
      [slotStringAt(1)]: 'b',
    })
    expect(rosterOf(bytes)).toBeNull()
  })

  it('CTF skins put players on Red and Blue when no slot string names a team', () => {
    const bytes = demo({
      [skinAt(0)]: 'a\\male/ctf_r',
      [skinAt(1)]: 'b\\female/ctf_b',
      [skinAt(2)]: 'c\\male/grunt',
    })
    expect(rosterOf(bytes)).toEqual({
      teams: [
        { name: 'Red', players: ['a'] },
        { name: 'Blue', players: ['b'] },
      ],
      spectators: ['c'],
    })
  })

  it("a reused slot's stale string does not put its new player on a team", () => {
    const bytes = demo(
      {
        [skinAt(0)]: 'x\\male/grunt',
        [skinAt(1)]: 'old\\male/grunt',
        [slotStringAt(0)]: 'x (Home)',
        [slotStringAt(1)]: 'old (Away)',
      },
      [[dm2Msg.configstring(skinAt(1), 'new\\female/athena')]],
    )
    expect(rosterOf(bytes)).toEqual({
      teams: [{ name: 'Home', players: ['x'] }],
      spectators: ['new'],
    })
  })

  it('only the last layout lists spectators, and only up to its next string2 heading', () => {
    const bytes = demo(
      {
        [skinAt(0)]: 'x\\male/grunt',
        [skinAt(1)]: 'y\\male/grunt',
        [slotStringAt(0)]: 'x (Home)',
        [slotStringAt(1)]: 'y (Away)',
      },
      [
        [layout('xv 0 yv 0 string2 " Spectators" yv 8 string "x:20->y   "')],
        [
          layout(
            'xv 0 yv 0 string2 " Spectators" yv 8 string "y:20->x   " yv 16 string "z:7"' +
              ' yv 24 string2 "Server" yv 32 string "w:9"',
          ),
        ],
      ],
    )
    expect(rosterOf(bytes)).toEqual({
      teams: [{ name: 'Home', players: ['x'] }],
      spectators: ['y', 'z'],
    })
  })

  it('a map change starts the roster over', () => {
    const bytes = demo({ [skinAt(0)]: 'x\\male/grunt', [slotStringAt(0)]: 'x (Home)' }, [
      [dm2Msg.serverdata(34)],
      [
        dm2Msg.configstring(skinAt(3), 'q\\male/grunt'),
        dm2Msg.configstring(slotStringAt(3), 'q (Away)'),
      ],
    ])
    expect(rosterOf(bytes)).toEqual({ teams: [{ name: 'Away', players: ['q'] }], spectators: [] })
  })

  it('collecting the roster keeps the full pass within budget of the frame count alone', () => {
    const bytes = fixture(OPENTDM_EXAMPLE)
    const countOnly = (): void => {
      const counter = createDm2FrameCounter()
      counter.push(bytes)
      counter.finish()
    }
    const countAndCollect = (): void => {
      const collector = createDm2RosterCollector()
      const counter = createDm2FrameCounter(collector)
      counter.push(bytes)
      counter.finish()
      collector.finish()
    }
    const medianMs = (run: () => void): number => {
      const times: number[] = []
      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        run()
        times.push(performance.now() - start)
      }
      return times.sort((a, b) => a - b)[10]!
    }
    for (let i = 0; i < 5; i++) {
      countOnly()
      countAndCollect()
    }
    const alone = medianMs(countOnly)
    expect(medianMs(countAndCollect)).toBeLessThanOrEqual(alone * 1.5 + 1)
  })
})
