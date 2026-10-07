/**
 * Collects a `.dm2` demo's teams and spectators while the frame count walks the file
 * (`createDm2FrameCounter(observer)` in `./dm2-frames.ts`), so the roster costs no second pass.
 *
 * The roster is the state at the end of the recording, rebuilt from the latest value of a few
 * configstrings plus the latest scoreboard layout:
 *
 * - **Player skins** (`CS_PLAYERSKINS + slot`, `name\model/skin`): which slots are connected, and
 *   under which name. Slots are reused, so a slot's other facts only count while they agree with
 *   its current name.
 * - **OpenTDM slot strings** (`CS_GENERAL + MAX_CLIENTS + slot`, `name (team)`): a slot is on
 *   `team` only while its string names the slot's current player — OpenTDM leaves the string of a
 *   player who went to spectator in place, and the next player in that slot inherits it.
 * - **CTF skins**, only when no slot string assigned a team: `ctf_r`/`ctf_b` are Red/Blue.
 * - **The last layout**: the names listed under its `Spectators` heading are spectators even if a
 *   stale slot string still puts them on a team.
 * - **The statusbar** (`CS_STATUSBAR`): its `string "<team>"` order is the team order shown.
 *
 * A fresh `svc_serverdata` (map change) starts over: the roster describes the last map.
 *
 * Team names are game data shown verbatim, never i18n keys. Pure by contract: this file lives in
 * `src/shared`, so no `node:*` import, no DOM types, no `Buffer`, no IPC.
 */

import { EXTENDED_LAYOUT, ORIGINAL_LAYOUT } from './dm2-header'
import type { Dm2Layout } from './dm2-header'
import type { Dm2FrameObserver } from './dm2-frames'

export type DemoRoster = { teams: { name: string; players: string[] }[]; spectators: string[] }

export interface Dm2RosterCollector extends Dm2FrameObserver {
  /** The roster at the end of the demo, or `null` when no team has a player. */
  finish(): DemoRoster | null
}

const CS_STATUSBAR = 5

const CTF_TEAMS: Partial<Record<string, string>> = { ctf_r: 'Red', ctf_b: 'Blue' }

/** A scoreboard spectator line: `name:ping` or `name:ping->followed`. */
const SPECTATOR_LINE = /^(.*):\d+(->.*)?\s*$/

type Slot = { name: string; skin: string }

/** The text argument of every `string`/`string2` command of a layout program, in order. */
function layoutTexts(program: string): { command: string; text: string }[] {
  const tokens = Array.from(program.matchAll(/"([^"]*)"?|\S+/g), (m) => m[1] ?? m[0])
  const texts: { command: string; text: string }[] = []
  for (let i = 0; i + 1 < tokens.length; i++) {
    const command = tokens[i]!
    if (command !== 'string' && command !== 'string2') continue
    texts.push({ command, text: tokens[i + 1]! })
    i++
  }
  return texts
}

function layoutSpectators(layout: string): string[] {
  const names: string[] = []
  let inSection = false
  for (const { command, text } of layoutTexts(layout)) {
    if (text.trim() === 'Spectators') inSection = true
    else if (command === 'string2') inSection = false
    else if (inSection) {
      const name = SPECTATOR_LINE.exec(text)?.[1]?.trim()
      if (name !== undefined && name !== '') names.push(name)
    }
  }
  return names
}

function parseSkin(value: string): Slot | undefined {
  if (value === '') return undefined
  const cut = value.indexOf('\\')
  if (cut === -1) return { name: value, skin: '' }
  const userinfo = value.slice(cut + 1)
  return { name: value.slice(0, cut), skin: userinfo.slice(userinfo.lastIndexOf('/') + 1) }
}

/** The team of a slot string that reads exactly `${name} (${team})`, else `null`. */
function openTdmTeam(name: string, slotString: string | undefined): string | null {
  const prefix = `${name} (`
  if (slotString === undefined || !slotString.startsWith(prefix) || !slotString.endsWith(')'))
    return null
  const team = slotString.slice(prefix.length, -1)
  return team === '' ? null : team
}

export function createDm2RosterCollector(): Dm2RosterCollector {
  let layout: Dm2Layout | null = null
  let slots: (Slot | undefined)[] = []
  let slotStrings: (string | undefined)[] = []
  let statusbar = ''
  let lastLayout = ''

  return {
    onServerdata(protocol: number): void {
      layout = protocol === 34 ? ORIGINAL_LAYOUT : EXTENDED_LAYOUT
      slots = []
      slotStrings = []
      statusbar = ''
      lastLayout = ''
    },
    onConfigstring(index: number, value: string): void {
      if (layout === null) return
      const general = layout.CS_PLAYERSKINS + layout.MAX_CLIENTS
      const stringsAt = general + layout.MAX_CLIENTS
      if (index === CS_STATUSBAR) statusbar = value
      else if (index >= layout.CS_PLAYERSKINS && index < general)
        slots[index - layout.CS_PLAYERSKINS] = parseSkin(value)
      else if (index >= stringsAt && index < stringsAt + layout.MAX_CLIENTS)
        slotStrings[index - stringsAt] = value
    },
    onLayout(text: string): void {
      lastLayout = text
    },
    finish(): DemoRoster | null {
      const connected = slots.flatMap((slot, i) => (slot === undefined ? [] : [{ ...slot, i }]))
      let teamOf = connected.map((slot) => openTdmTeam(slot.name, slotStrings[slot.i]))
      if (teamOf.every((team) => team === null))
        teamOf = connected.map((slot) => CTF_TEAMS[slot.skin.toLowerCase()] ?? null)

      const layoutNames = layoutSpectators(lastLayout)
      const asSpectator = new Set(layoutNames)
      const teams = new Map<string, string[]>()
      const spectators: string[] = []
      connected.forEach((slot, n) => {
        const team = teamOf[n]
        if (team === null || team === undefined || asSpectator.has(slot.name)) {
          spectators.push(slot.name)
          return
        }
        const players = teams.get(team)
        if (players === undefined) teams.set(team, [slot.name])
        else players.push(slot.name)
      })
      if (teams.size === 0) return null

      const shown = layoutTexts(statusbar).map(({ text }) => text.trim())
      const rank = (team: string): number => {
        const at = shown.indexOf(team)
        return at === -1 ? Number.POSITIVE_INFINITY : at
      }
      return {
        // Stable sort; two unnamed teams compare as NaN (`|| 0`), keeping first-appearance order.
        teams: [...teams]
          .map(([name, players]) => ({ name, players }))
          .sort((a, b) => rank(a.name) - rank(b.name) || 0),
        spectators: [...new Set([...spectators, ...layoutNames])],
      }
    },
  }
}
