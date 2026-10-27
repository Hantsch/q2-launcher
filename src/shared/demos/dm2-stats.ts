/**
 * Collects the end-of-match accuracy stats a `.dm2` demo carries as print text, while the frame
 * count walks the file (`onPrint` of `createDm2FrameCounter`'s observer), so the stats cost no
 * second pass.
 *
 * OpenTDM prints a per-weapon table and a totals table for the recording player:
 *
 * ```
 * Stats for shad:
 *
 *             Item | Acc. Kills Deaths Dealt Recvd Pick Miss
 * -----------------+----------------------------------------
 *          Railgun |  36%     3     11  1000  2000    6    3
 * Total  | Kills Dths Sui TKs Tele Dealt Recvd TDealt TRecvd
 * -------+---------------------------------------------------
 * Player |    10   27   1   0    0  3296  4791      0      0
 * ```
 *
 * The text is split over several `svc_print` messages with no regard for line ends, and parts of it
 * are high-bit ("green") characters, so every print is concatenated into one line stream with the
 * high bit stripped. A `-` cell is the game's "not applicable" and becomes `null`. A table whose
 * columns are not exactly the ones above is not trusted and never replaces an earlier good one;
 * the last complete block wins.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

/** `null` = the game's `-` cell. */
export type DemoStatValue = number | null

export type DemoStatsItem = {
  item: string
  accuracy: DemoStatValue
  kills: DemoStatValue
  deaths: DemoStatValue
  dealt: DemoStatValue
  received: DemoStatValue
  pickups: DemoStatValue
  missed: DemoStatValue
}

export type DemoStatsTotal = {
  kills: DemoStatValue
  deaths: DemoStatValue
  suicides: DemoStatValue
  teamKills: DemoStatValue
  telefrags: DemoStatValue
  dealt: DemoStatValue
  received: DemoStatValue
  teamDealt: DemoStatValue
  teamReceived: DemoStatValue
}

export type DemoStats = { player: string; items: DemoStatsItem[]; total: DemoStatsTotal | null }

export interface Dm2StatsCollector {
  onPrint(level: number, text: string): void
  /** The last complete stats block of the demo, or `null` when there is none. */
  finish(): DemoStats | null
}

const STATS_FOR = /^Stats for (.+):$/
const SEPARATOR = /^[-+\s]+$/

const ITEM_COLUMNS = 'Acc. Kills Deaths Dealt Recvd Pick Miss'
const TOTAL_COLUMNS = 'Kills Dths Sui TKs Tele Dealt Recvd TDealt TRecvd'

/** `expect-header` until the item header, `items` while rows come, `total` after the Total header. */
type Phase = 'expect-header' | 'items' | 'total'

type Block = { player: string; items: DemoStatsItem[]; phase: Phase }

/** A `left | right` line as its trimmed left side and the right side's tokens, or `null`. */
function columns(line: string): { left: string; tokens: string[] } | null {
  const parts = line.split('|')
  if (parts.length !== 2) return null
  const tokens = parts[1]!.trim().split(/\s+/)
  return { left: parts[0]!.trim(), tokens: tokens[0] === '' ? [] : tokens }
}

/** `-` → `null`, digits → their value, anything else → `undefined` (not a stat cell). */
function cell(token: string, percent = false): DemoStatValue | undefined {
  if (token === '-') return null
  const digits = percent && token.endsWith('%') ? token.slice(0, -1) : token
  return /^\d+$/.test(digits) ? Number.parseInt(digits, 10) : undefined
}

/** Exactly `count` stat cells, or `null`; `percentFirst` lets the first carry a `%` (Acc.). */
function cells(tokens: string[], count: number, percentFirst: boolean): DemoStatValue[] | null {
  if (tokens.length !== count) return null
  const values = tokens.map((token, i) => cell(token, percentFirst && i === 0))
  return values.every((v) => v !== undefined) ? (values as DemoStatValue[]) : null
}

function itemRow(line: string): DemoStatsItem | null {
  const split = columns(line)
  if (split === null || split.left === '') return null
  const v = cells(split.tokens, 7, true)
  if (v === null) return null
  return {
    item: split.left,
    accuracy: v[0]!,
    kills: v[1]!,
    deaths: v[2]!,
    dealt: v[3]!,
    received: v[4]!,
    pickups: v[5]!,
    missed: v[6]!,
  }
}

function totalRow(line: string): DemoStatsTotal | null {
  const split = columns(line)
  if (split === null || split.left !== 'Player') return null
  const v = cells(split.tokens, 9, false)
  if (v === null) return null
  return {
    kills: v[0]!,
    deaths: v[1]!,
    suicides: v[2]!,
    teamKills: v[3]!,
    telefrags: v[4]!,
    dealt: v[5]!,
    received: v[6]!,
    teamDealt: v[7]!,
    teamReceived: v[8]!,
  }
}

function isHeader(line: string, left: string, names: string): boolean {
  const split = columns(line)
  return split !== null && split.left === left && split.tokens.join(' ') === names
}

export function createDm2StatsCollector(): Dm2StatsCollector {
  let tail = ''
  let block: Block | null = null
  let result: DemoStats | null = null

  /** Closes the open block; only a block with at least one row replaces the result. */
  function close(total: DemoStatsTotal | null): void {
    if (block !== null && block.items.length > 0)
      result = { player: block.player, items: block.items, total }
    block = null
  }

  function onLine(line: string): void {
    const trimmed = line.trim()
    const opens = STATS_FOR.exec(trimmed)
    if (opens !== null) {
      close(null)
      block = { player: opens[1]!.trim(), items: [], phase: 'expect-header' }
      return
    }
    if (block === null) return
    if (trimmed === '' || (SEPARATOR.test(trimmed) && trimmed.includes('-'))) return
    switch (block.phase) {
      case 'expect-header':
        if (isHeader(line, 'Item', ITEM_COLUMNS)) block.phase = 'items'
        else block = null
        return
      case 'items': {
        const row = itemRow(line)
        if (row !== null) block.items.push(row)
        else if (isHeader(line, 'Total', TOTAL_COLUMNS)) block.phase = 'total'
        else close(null) // the line was already checked for opening the next block
        return
      }
      case 'total':
        close(totalRow(line))
        return
    }
  }

  return {
    onPrint(_level: number, text: string): void {
      let clean = ''
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i) & 0x7f
        if (c !== 0x0d) clean += String.fromCharCode(c)
      }
      const lines = (tail + clean).split('\n')
      tail = lines.pop()!
      for (const line of lines) onLine(line)
    },
    finish(): DemoStats | null {
      if (tail !== '') onLine(tail)
      tail = ''
      close(null)
      return result
    },
  }
}
