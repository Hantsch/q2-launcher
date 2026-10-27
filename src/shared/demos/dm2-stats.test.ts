import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createDm2FactsCollector } from './dm2-facts'
import { createDm2FrameCounter } from './dm2-frames'
import { buildDm2Stream, dm2Msg } from './dm2-frames-writer'
import type { Dm2StreamMessage } from './dm2-frames-writer'
import type { DemoStats } from './dm2-stats'

const OPENTDM_EXAMPLE = 'shad-maq_PFDE3_q2rdm2_20260922-161521.dm2'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(__dirname, '../../../docs/fixtures/demos', name)))
}

/** The stats of `bytes`, collected by the frame count's own pass. */
function statsOf(bytes: Uint8Array): DemoStats | null {
  const facts = createDm2FactsCollector()
  const counter = createDm2FrameCounter(facts)
  counter.push(bytes)
  expect(counter.finish().ok).toBe(true)
  return facts.finish().stats
}

/** A demo whose blocks carry `prints` (one print per block), each followed by a frame. */
function demoPrinting(...prints: string[]): Uint8Array {
  const blocks: Dm2StreamMessage[][] = prints.map((text, i) => [
    dm2Msg.print(text),
    dm2Msg.frame(i),
  ])
  return buildDm2Stream({ protocol: 34, blocks, terminate: true })
}

/** OpenTDM's high-bit ("green") rendering of `text`. */
function green(text: string): string {
  return [...text].map((c) => String.fromCharCode(c.charCodeAt(0) | 0x80)).join('')
}

const ITEM_HEADER = '            Item | Acc. Kills Deaths Dealt Recvd Pick Miss'
const ITEM_SEP = '-----------------+----------------------------------------'
const TOTAL_HEADER = 'Total  | Kills Dths Sui TKs Tele Dealt Recvd TDealt TRecvd'
const TOTAL_SEP = '-------+---------------------------------------------------'

/** The two prints OpenTDM sends for one block: the item table, then the totals table. */
function statsPrints(
  player: string,
  rows: string[],
  totalRow: string | null,
  itemHeader = ITEM_HEADER,
): [string, string] {
  const items = `Stats for ${player}:\n\n${itemHeader}\n${ITEM_SEP}\n${rows.join('\n')}\n`
  const total = totalRow === null ? '\n' : `\n${TOTAL_HEADER}\n${TOTAL_SEP}\n${totalRow}\n\n`
  return [items, total]
}

const RAIL_36 = '         Railgun |  36%     3     11  1000  2000    6    3'
const RAIL_50 = '         Railgun |  50%     8      2   900   300    4    1'
const PLAYER_10 = 'Player |    10   27   1   0    0  3296  4791      0      0'
const PLAYER_20 = 'Player |    20    5   0   1    2   900   300      4      5'

const RAIL_36_ITEM = {
  item: 'Railgun',
  accuracy: 36,
  kills: 3,
  deaths: 11,
  dealt: 1000,
  received: 2000,
  pickups: 6,
  missed: 3,
}

describe('createDm2StatsCollector', () => {
  it("the OpenTDM example yields shad's item rows and total", () => {
    const stats = statsOf(fixture(OPENTDM_EXAMPLE))
    expect(stats?.player).toBe('shad')
    expect(stats?.items.map((row) => row.item)).toEqual([
      'Blaster',
      'Super Shotgun',
      'Machinegun',
      'Chaingun',
      'Grenades',
      'Grenade Launcher',
      'Rocket Launcher',
      'Railgun',
      'Combat Armor',
      'MegaHealth',
    ])
    expect(stats?.items.find((row) => row.item === 'Railgun')).toEqual(RAIL_36_ITEM)
    expect(stats?.items.find((row) => row.item === 'Grenade Launcher')).toMatchObject({
      accuracy: null,
      kills: null,
      deaths: 0,
      dealt: null,
    })
    expect(stats?.total).toEqual({
      kills: 10,
      deaths: 27,
      suicides: 1,
      teamKills: 0,
      telefrags: 0,
      dealt: 3296,
      received: 4791,
      teamDealt: 0,
      teamReceived: 0,
    })
  })

  it('a demo without a stats block has no stats', () => {
    expect(statsOf(demoPrinting('shad: gg\n', 'Timelimit hit.\n'))).toBeNull()
    expect(statsOf(fixture('test.dm2'))).toBeNull()
  })

  it('with several blocks the last complete one wins', () => {
    const stats = statsOf(
      demoPrinting(
        ...statsPrints('shad', [RAIL_36], PLAYER_10),
        'shad: gg\n',
        ...statsPrints('maq', [RAIL_50], PLAYER_20),
      ),
    )
    expect(stats?.player).toBe('maq')
    expect(stats?.items).toEqual([
      {
        ...RAIL_36_ITEM,
        accuracy: 50,
        kills: 8,
        deaths: 2,
        dealt: 900,
        received: 300,
        pickups: 4,
        missed: 1,
      },
    ])
    expect(stats?.total).toMatchObject({ kills: 20, deaths: 5, teamDealt: 4, teamReceived: 5 })
  })

  it('a malformed block does not replace an earlier good one', () => {
    const unknownColumn = `${ITEM_HEADER} Bonus`
    const badCell = '         Railgun |  50%     x      2   900   300    4    1'
    const stats = statsOf(
      demoPrinting(
        ...statsPrints('shad', [RAIL_36], PLAYER_10),
        ...statsPrints('maq', [RAIL_50], PLAYER_20, unknownColumn),
        ...statsPrints('maq', [badCell], PLAYER_20),
        'Stats for maq:\n',
      ),
    )
    expect(stats).toMatchObject({ player: 'shad', items: [RAIL_36_ITEM], total: { kills: 10 } })
  })

  it('a block split mid-line over two prints parses', () => {
    const text = statsPrints('shad', [RAIL_36], PLAYER_10).join('')
    const whole = statsOf(demoPrinting(text))
    for (const cut of [5, text.indexOf('Railgun') + 3, text.indexOf('Player |') + 9]) {
      const split = statsOf(demoPrinting('shad: gg\n', text.slice(0, cut), text.slice(cut)))
      expect(split, `cut at ${cut}`).toEqual(whole)
    }
    expect(whole).toMatchObject({ player: 'shad', items: [RAIL_36_ITEM], total: { kills: 10 } })
  })

  it('a block without the Total part has no total', () => {
    const stats = statsOf(demoPrinting(...statsPrints('shad', [RAIL_36], null), 'shad: gg\n'))
    expect(stats).toEqual({ player: 'shad', items: [RAIL_36_ITEM], total: null })
  })

  it('high-bit text parses', () => {
    const [items, total] = statsPrints('shad', [RAIL_36], PLAYER_10, green(ITEM_HEADER))
    const stats = statsOf(demoPrinting(green(items.slice(0, 16)) + items.slice(16), total))
    expect(stats).toMatchObject({ player: 'shad', items: [RAIL_36_ITEM], total: { kills: 10 } })
  })

  it('carriage returns are dropped', () => {
    const text = statsPrints('shad', [RAIL_36], PLAYER_10).join('').replaceAll('\n', '\r\n')
    expect(statsOf(demoPrinting(text))?.total).toMatchObject({ kills: 10, teamReceived: 0 })
  })
})
