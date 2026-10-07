/**
 * File-name template engine for demos — pure. A template such as `{map}_{date}_{time}.dm2` is
 * compiled once (`compileNameTemplate`, which validates it and reports an i18n error key when it is
 * unusable) and then matched against file names (`matchNameTemplate`), yielding the facts the name
 * gives away (date, map, POV, players, teams, host).
 *
 * Matching uses no regex: it counts the ways a name can be split along the template with a memoised
 * DP over (segment index, offset, pending date parts) and stops counting at two, so a name is
 * classified as no match, exactly one match, or ambiguous in polynomial time regardless of how many
 * separators it contains.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */

import { refuse, type DomainResult } from '../types/common'

/** Tokens matching any non-empty run of characters. `skip` matches but contributes no fact. */
export const NAME_TEMPLATE_TEXT_TOKENS = [
  'map',
  'pov',
  'p1',
  'p2',
  'p3',
  'p4',
  'p5',
  'p6',
  'p7',
  'p8',
  'p9',
  'teamA',
  'teamB',
  'host',
  'skip',
] as const

/** Fixed-width digit tokens. */
export const NAME_TEMPLATE_DIGIT_TOKENS = ['year', 'month', 'day', 'hour', 'min', 'sec'] as const

/** Shorthands expanded before validation: `{date}` → `{year}-{month}-{day}`, `{time}` → `{hour}-{min}-{sec}`. */
export const NAME_TEMPLATE_SHORTHANDS = ['date', 'time'] as const

/** The full vocabulary a template may use inside `{…}`. */
export const NAME_TEMPLATE_TOKENS = [
  ...NAME_TEMPLATE_TEXT_TOKENS,
  ...NAME_TEMPLATE_DIGIT_TOKENS,
  ...NAME_TEMPLATE_SHORTHANDS,
] as const

export type NameTemplateTextToken = (typeof NAME_TEMPLATE_TEXT_TOKENS)[number]
export type NameTemplateDigitToken = (typeof NAME_TEMPLATE_DIGIT_TOKENS)[number]
export type NameTemplateToken = (typeof NAME_TEMPLATE_TOKENS)[number]

/** i18n keys for every reason `compileNameTemplate` rejects a template. */
export const NAME_TEMPLATE_ERROR = {
  empty: 'replays.nameTemplate.error.empty',
  unclosedBrace: 'replays.nameTemplate.error.unclosedBrace',
  strayBrace: 'replays.nameTemplate.error.strayBrace',
  unknownToken: 'replays.nameTemplate.error.unknownToken',
  duplicateToken: 'replays.nameTemplate.error.duplicateToken',
  adjacentTextTokens: 'replays.nameTemplate.error.adjacentTextTokens',
  capturesNothing: 'replays.nameTemplate.error.capturesNothing',
  incompleteDate: 'replays.nameTemplate.error.incompleteDate',
  timeWithoutDate: 'replays.nameTemplate.error.timeWithoutDate',
  misplacedExtension: 'replays.nameTemplate.error.misplacedExtension',
} as const

export type NameTemplateErrorKey = (typeof NAME_TEMPLATE_ERROR)[keyof typeof NAME_TEMPLATE_ERROR]

/** One piece of a compiled template. Literal text is stored ASCII-lower-cased. */
export type NameTemplateSegment =
  | { kind: 'literal'; text: string }
  | { kind: 'text'; token: NameTemplateTextToken }
  | { kind: 'digit'; token: NameTemplateDigitToken; width: number }

export interface CompiledNameTemplate {
  readonly source: string
  /** The template's trailing extension literal, lower-cased, or `null` when it names none. */
  readonly extension: '.dm2' | '.mvd2' | null
  /** Segments with the extension stripped and shorthands expanded; adjacent literals are merged. */
  readonly segments: readonly NameTemplateSegment[]
}

export type CompileNameTemplateResult = DomainResult<
  { template: CompiledNameTemplate },
  NameTemplateErrorKey
>

export interface NameFacts {
  date?: {
    year: number
    month: number
    day: number
    hour?: number
    minute?: number
    second?: number
  }
  map?: string
  pov?: string
  /** `{p1}`…`{p9}` captures in index order; only the tokens the template contains. */
  players?: string[]
  teamA?: string
  teamB?: string
  host?: string
  /** No shipped pattern fills this; reserved for a future user-defined template token. */
  gamemode?: string
}

export type NameTemplateMatch =
  { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'match'; facts: NameFacts }

const DIGIT_WIDTH: Record<NameTemplateDigitToken, number> = {
  year: 4,
  month: 2,
  day: 2,
  hour: 2,
  min: 2,
  sec: 2,
}

const SHORTHAND_EXPANSION: Record<
  (typeof NAME_TEMPLATE_SHORTHANDS)[number],
  (string | NameTemplateDigitToken)[]
> = {
  date: ['year', '-', 'month', '-', 'day'],
  time: ['hour', '-', 'min', '-', 'sec'],
}

const EXTENSIONS = ['.mvd2', '.dm2'] as const

function asciiLower(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]
  }
  return out
}

function endsWithCi(s: string, suffix: string): boolean {
  return s.length >= suffix.length && asciiLower(s.slice(s.length - suffix.length)) === suffix
}

function isTextToken(name: string): name is NameTemplateTextToken {
  return (NAME_TEMPLATE_TEXT_TOKENS as readonly string[]).includes(name)
}

function isDigitToken(name: string): name is NameTemplateDigitToken {
  return (NAME_TEMPLATE_DIGIT_TOKENS as readonly string[]).includes(name)
}

function isShorthand(name: string): name is (typeof NAME_TEMPLATE_SHORTHANDS)[number] {
  return (NAME_TEMPLATE_SHORTHANDS as readonly string[]).includes(name)
}

type RawPiece = { kind: 'literal'; text: string } | { kind: 'token'; name: string }

/**
 * Compiles and validates a template. Validation order: empty, brace structure, unknown tokens,
 * misplaced extension, duplicates, adjacent text tokens, nothing captured, incomplete date, time
 * without date — the first failing rule is reported.
 */
export function compileNameTemplate(text: string): CompileNameTemplateResult {
  if (text === '') return refuse(NAME_TEMPLATE_ERROR.empty)

  const pieces: RawPiece[] = []
  let literal = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') {
      let j = i + 1
      while (j < text.length && text[j] !== '}' && text[j] !== '{') j++
      if (j >= text.length || text[j] === '{')
        return refuse(NAME_TEMPLATE_ERROR.unclosedBrace, { position: i })
      if (literal !== '') pieces.push({ kind: 'literal', text: literal })
      literal = ''
      pieces.push({ kind: 'token', name: text.slice(i + 1, j) })
      i = j + 1
    } else if (ch === '}') {
      return refuse(NAME_TEMPLATE_ERROR.strayBrace, { position: i })
    } else {
      literal += ch
      i++
    }
  }
  if (literal !== '') pieces.push({ kind: 'literal', text: literal })

  for (const p of pieces) {
    if (
      p.kind === 'token' &&
      !isTextToken(p.name) &&
      !isDigitToken(p.name) &&
      !isShorthand(p.name)
    ) {
      return refuse(NAME_TEMPLATE_ERROR.unknownToken, { token: p.name })
    }
  }

  const lowerText = asciiLower(text)
  for (const ext of EXTENSIONS) {
    let at = lowerText.indexOf(ext)
    while (at !== -1) {
      if (at + ext.length !== lowerText.length) {
        return refuse(NAME_TEMPLATE_ERROR.misplacedExtension, { extension: ext })
      }
      at = lowerText.indexOf(ext, at + 1)
    }
  }
  const extension = EXTENSIONS.find((ext) => lowerText.endsWith(ext)) ?? null
  if (extension !== null) {
    // A trailing extension is necessarily inside the last (literal) piece: tokens end with `}`.
    const last = pieces[pieces.length - 1] as { kind: 'literal'; text: string }
    const rest = last.text.slice(0, last.text.length - extension.length)
    if (rest === '') pieces.pop()
    else pieces[pieces.length - 1] = { kind: 'literal', text: rest }
  }

  const segments: NameTemplateSegment[] = []
  const pushLiteral = (s: string): void => {
    const prev = segments[segments.length - 1]
    if (prev !== undefined && prev.kind === 'literal') prev.text += asciiLower(s)
    else segments.push({ kind: 'literal', text: asciiLower(s) })
  }
  const pushToken = (name: string): void => {
    if (isTextToken(name)) segments.push({ kind: 'text', token: name })
    else if (isDigitToken(name))
      segments.push({ kind: 'digit', token: name, width: DIGIT_WIDTH[name] })
  }
  for (const p of pieces) {
    if (p.kind === 'literal') pushLiteral(p.text)
    else if (isShorthand(p.name)) {
      for (const part of SHORTHAND_EXPANSION[p.name]) {
        if (isDigitToken(part)) pushToken(part)
        else pushLiteral(part)
      }
    } else pushToken(p.name)
  }

  const seen = new Set<string>()
  for (const s of segments) {
    if (s.kind === 'literal' || s.token === 'skip') continue
    if (seen.has(s.token)) return refuse(NAME_TEMPLATE_ERROR.duplicateToken, { token: s.token })
    seen.add(s.token)
  }

  for (let k = 1; k < segments.length; k++) {
    const a = segments[k - 1]
    const b = segments[k]
    if (a.kind === 'text' && b.kind === 'text') {
      return refuse(NAME_TEMPLATE_ERROR.adjacentTextTokens, { first: a.token, second: b.token })
    }
  }

  if (seen.size === 0) return refuse(NAME_TEMPLATE_ERROR.capturesNothing)

  const dateParts = (['year', 'month', 'day'] as const).filter((t) => seen.has(t)).length
  if (dateParts === 1 || dateParts === 2) return refuse(NAME_TEMPLATE_ERROR.incompleteDate)
  const hasTime = seen.has('hour') || seen.has('min') || seen.has('sec')
  if ((hasTime && dateParts !== 3) || (seen.has('hour') && !seen.has('min'))) {
    return refuse(NAME_TEMPLATE_ERROR.timeWithoutDate)
  }

  return { ok: true, template: { source: text, extension, segments } }
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31
}

/*
 * Pending date state, as one number so it can be part of a numeric memo key:
 * `(year + 1) * 10000 + month * 100 + day`, with 0 for an unknown part (valid months/days are ≥ 1).
 * `0` overall means "no date part pending" — either none seen yet or all three seen and validated;
 * which one is fixed by the segment index, so the collapse is unambiguous.
 */
const INVALID = -1

function applyDigit(token: NameTemplateDigitToken, v: number, state: number): number {
  switch (token) {
    case 'hour':
      return v <= 23 ? state : INVALID
    case 'min':
    case 'sec':
      return v <= 59 ? state : INVALID
    default:
      break
  }
  let y = Math.floor(state / 10000) - 1
  let m = Math.floor(state / 100) % 100
  let d = state % 100
  if (token === 'year') y = v
  else if (token === 'month') {
    if (v < 1 || v > 12) return INVALID
    m = v
  } else {
    if (v < 1 || v > 31) return INVALID
    d = v
  }
  if (y >= 0 && m > 0 && d > 0) return d <= daysInMonth(y, m) ? 0 : INVALID
  return (y + 1) * 10000 + m * 100 + d
}

function readDigits(s: string, pos: number, width: number): number {
  if (pos + width > s.length) return INVALID
  let v = 0
  for (let k = pos; k < pos + width; k++) {
    const c = s.charCodeAt(k)
    if (c < 48 || c > 57) return INVALID
    v = v * 10 + (c - 48)
  }
  return v
}

function literalAt(lower: string, pos: number, lit: string): boolean {
  return lower.startsWith(lit, pos)
}

const NONE: NameTemplateMatch = { kind: 'none' }
const AMBIGUOUS: NameTemplateMatch = { kind: 'ambiguous' }

/**
 * Matches `fileName` against a compiled template. A trailing `.gz` is dropped first; a template
 * extension must then be present (case-insensitively) and is stripped, while a template without one
 * accepts `.dm2`, `.mvd2` or no extension. Literals compare ASCII-case-insensitively; captures keep
 * the file name's casing. Returns `ambiguous` when two or more distinct splits are valid.
 */
export function matchNameTemplate(t: CompiledNameTemplate, fileName: string): NameTemplateMatch {
  let name = fileName
  if (endsWithCi(name, '.gz')) name = name.slice(0, -3)
  if (t.extension !== null) {
    if (!endsWithCi(name, t.extension)) return NONE
    name = name.slice(0, -t.extension.length)
  } else {
    const ext = EXTENSIONS.find((e) => endsWithCi(name, e))
    if (ext !== undefined) name = name.slice(0, -ext.length)
  }

  const lower = asciiLower(name)
  const n = name.length
  const segs = t.segments
  const memo = new Map<number, number>()

  /** Calls `visit(end, nextState)` for every way segment `i` can consume from `pos`; stops when it returns true. */
  const forEachEdge = (
    i: number,
    pos: number,
    state: number,
    visit: (end: number, nextState: number) => boolean,
  ): void => {
    const seg = segs[i]
    if (seg.kind === 'literal') {
      if (literalAt(lower, pos, seg.text)) visit(pos + seg.text.length, state)
      return
    }
    if (seg.kind === 'digit') {
      const v = readDigits(name, pos, seg.width)
      if (v === INVALID) return
      const next = applyDigit(seg.token, v, state)
      if (next !== INVALID) visit(pos + seg.width, next)
      return
    }
    const following = segs[i + 1]
    if (following === undefined) {
      if (n > pos) visit(n, state)
      return
    }
    for (let end = pos + 1; end < n; end++) {
      if (following.kind === 'literal' && !literalAt(lower, end, following.text)) continue
      if (visit(end, state)) return
    }
  }

  /** Number of valid splits of `name[pos..]` along `segs[i..]`, capped at 2. */
  const count = (i: number, pos: number, state: number): number => {
    if (i === segs.length) return pos === n ? 1 : 0
    const key = (state * (segs.length + 1) + i) * (n + 1) + pos
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let total = 0
    forEachEdge(i, pos, state, (end, next) => {
      total += count(i + 1, end, next)
      if (total >= 2) {
        total = 2
        return true
      }
      return false
    })
    memo.set(key, total)
    return total
  }

  const ways = count(0, 0, 0)
  if (ways === 0) return NONE
  if (ways >= 2) return AMBIGUOUS

  // Exactly one split: walk it, at each segment taking the only edge that still leads to a match.
  const texts = new Map<NameTemplateTextToken, string>()
  const digits = new Map<NameTemplateDigitToken, number>()
  let pos = 0
  let state = 0
  for (let i = 0; i < segs.length; i++) {
    let end = INVALID
    let nextState = 0
    forEachEdge(i, pos, state, (e, next) => {
      if (count(i + 1, e, next) === 0) return false
      end = e
      nextState = next
      return true
    })
    const seg = segs[i]
    if (seg.kind === 'text' && seg.token !== 'skip') texts.set(seg.token, name.slice(pos, end))
    else if (seg.kind === 'digit') digits.set(seg.token, readDigits(name, pos, seg.width))
    pos = end
    state = nextState
  }

  return { kind: 'match', facts: buildFacts(texts, digits) }
}

function buildFacts(
  texts: Map<NameTemplateTextToken, string>,
  digits: Map<NameTemplateDigitToken, number>,
): NameFacts {
  const facts: NameFacts = {}
  const year = digits.get('year')
  const month = digits.get('month')
  const day = digits.get('day')
  if (year !== undefined && month !== undefined && day !== undefined) {
    const date: NonNullable<NameFacts['date']> = { year, month, day }
    const hour = digits.get('hour')
    const minute = digits.get('min')
    const second = digits.get('sec')
    if (hour !== undefined) date.hour = hour
    if (minute !== undefined) date.minute = minute
    if (second !== undefined) date.second = second
    facts.date = date
  }
  for (const key of ['map', 'pov', 'teamA', 'teamB', 'host'] as const) {
    const v = texts.get(key)
    if (v !== undefined) facts[key] = v
  }
  const players: string[] = []
  for (const key of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'] as const) {
    const v = texts.get(key)
    if (v !== undefined) players.push(v)
  }
  if (players.length > 0) facts.players = players
  return facts
}
