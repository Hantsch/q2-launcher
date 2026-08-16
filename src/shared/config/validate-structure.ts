/**
 * Structural profile checks - story 009 D3.
 *
 * Runs over the *rendered* text of a profile's files, never over 006's/008's
 * internal data shapes, because the rendered output is the one thing every
 * rule here actually cares about: what the engine reads is exactly this text,
 * byte for byte. A rule that fired on the data model could be right about the
 * model and still wrong about the file.
 *
 * Ported in spirit from the external q2-config-manager project
 * (`src/core/validator.ts`'s alias/size/quote blocks), adapted to this
 * codebase's rendered line shapes (`render.ts`, `alt-layers.ts`,
 * `alias-render.ts`) rather than upstream's own `Alias`/`Profile` model.
 *
 * ## Subject derivation (story decision)
 *
 * A finding's `subject` comes from the offending line's own head tokens:
 * `set <name>` -> `{kind:'cvar', id:name}`, `bind <key>` -> `{kind:'bind',
 * id:key}`, `alias <name>` -> `{kind:'alias', id:name}`, everything else (the
 * sentinel comment, an `exec` line, a garbled line) -> `{kind:'file',
 * id:fileName}`. A finding about the whole file (its total size) is always
 * `{kind:'file', id:fileName}`.
 *
 * ## What an out-of-scope engine gets
 *
 * `limitsFor()` yields `undefined` for every `EngineKind` outside
 * r1q2/q2pro/vanilla, and this module never substitutes another engine's
 * numbers for it. Concretely:
 *
 *  - **Total size** and **per-line length** are skipped entirely. Both read
 *    their number out of the resolved `EngineLimits` (`execBufferBytes`,
 *    `maxLineBytes`); the size budget alone differs by nearly an order of
 *    magnitude between the three known engines and is not even measured on the
 *    same bytes, so guessing it for a fourth engine would be worse than saying
 *    nothing.
 *  - **Alias name length, spaces, duplicates, cycles and depth** still run.
 *    Those use `MAX_ALIAS_NAME`/`ALIAS_LOOP_COUNT`, which are not one engine's
 *    tuning but the shared `cmd.c` console implementation every Quake II
 *    derivative inherited; `EngineLimits` carries them per engine only so a
 *    future port that changed them can say so, and when a resolved
 *    `EngineLimits` exists its numbers are used in preference to the bare
 *    constants.
 *
 * Which engines are worth validating at all is D5's decision
 * (`engineScope()`); this module stays callable for any of them without ever
 * attributing r1q2's numbers to another engine.
 */

import type { EngineKind } from '../types/engine'
import {
  ALIAS_LOOP_COUNT,
  MAX_ALIAS_NAME,
  evaluateSize,
  limitsFor,
  type EngineLimits,
} from './engine-limits'
import type { Finding, FindingSubject } from './validation'

/** One rendered file, e.g. `{ name: profileFileName(id), content: renderProfileFile(profile) }`. */
export interface StructureFile {
  name: string
  content: string
}

/** Shared prefix of every message key this module emits. D4 owns the sibling `config.validation.cvar.*`. */
export const STRUCTURE_MESSAGE_PREFIX = 'config.validation.structure.'

/**
 * Literal engine source citations (`Finding.source`), same precedent as
 * `EngineOverride.source` in `cvar-facts.ts`: never translated, never prose.
 * Function names only, no line numbers - those differ between the three
 * engines' trees while the functions do not.
 */
const SOURCE = {
  line: 'qcommon/cmd.c Cbuf_Execute (char line[1024])',
  aliasName: 'qcommon/cmd.c Cmd_Alias_f (MAX_ALIAS_NAME)',
  aliasReplace: 'qcommon/cmd.c Cmd_Alias_f (an existing alias is overwritten in place)',
  aliasLoop: 'qcommon/cmd.c Cmd_ExecuteString (ALIAS_LOOP_COUNT)',
  quote: 'qcommon/common.c COM_Parse (no escape character inside a quoted token)',
  size: 'qcommon/cmd.c Cbuf_AddText / Cmd_Exec_f (command buffer size)',
} as const

// ---------------------------------------------------------------------------
// Tokenizing - Quake II's rules, not JavaScript's
// ---------------------------------------------------------------------------

/**
 * Byte length of `text` written as latin1, which is what the config writer
 * emits. `String.length` counts UTF-16 code units, and that IS the latin1 byte
 * count - same reasoning, and the same one-line helper, as
 * `alt-layers.ts#latin1ByteLength`. Deliberately not `Buffer.byteLength`:
 * besides being a node import `src/shared` may not make, a UTF-8 assumption
 * would double-count every high-ASCII character and hand the user a budget
 * that is wrong for exactly the "Bjorn"-style content this codebase
 * round-trip tests.
 */
function latin1ByteLength(text: string): number {
  return text.length
}

const WHITESPACE = /\s/

/** Command names that assign a cvar, mirroring `config-parser.ts`'s `CVAR_COMMANDS`. */
const CVAR_COMMANDS = new Set(['set', 'seta', 'setu', 'sets'])

/**
 * One token plus where it sat in its segment, so a rule can look at the raw
 * text *after* a token - which is what the quoting rule needs - instead of
 * reassembling it from tokens and losing the original spacing.
 */
interface Token {
  /** The token's value; for a quoted token, the text between the quotes. */
  text: string
  /** Index of the token's first character, including an opening quote. */
  start: number
  /** Index just past the token, including its closing quote when it had one. */
  end: number
}

/**
 * Tokenizes one command segment the way `COM_Parse` does, mirroring
 * `config-parser.ts#tokenize`. Reimplemented rather than imported: that copy
 * lives in `src/main`, which `src/shared` must not depend on, and it reports
 * no offsets. Skip whitespace; a token that *starts* with `"` runs to the next
 * `"` or to the end of the segment; anything else runs to the next whitespace.
 * There is no escaping anywhere - that absence is the whole point of the
 * quoting rule further down.
 */
function tokenize(segment: string): Token[] {
  const tokens: Token[] = []
  const n = segment.length
  let i = 0

  while (i < n) {
    while (i < n && WHITESPACE.test(segment[i])) i++
    if (i >= n) break

    const start = i
    if (segment[i] === '"') {
      i++
      const textStart = i
      while (i < n && segment[i] !== '"') i++
      const text = segment.slice(textStart, i)
      if (i < n) i++ // consume the closing quote, when there was one
      tokens.push({ text, start, end: i })
    } else {
      while (i < n && !WHITESPACE.test(segment[i])) i++
      tokens.push({ text: segment.slice(start, i), start, end: i })
    }
  }

  return tokens
}

/** Everything before an unquoted `//`, quote state tracked so a URL inside a value survives. */
function stripLineComment(line: string): string {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}

/** Splits on `;` outside a quoted span - the engine's own command separator. */
function splitTopLevelSemicolons(line: string): string[] {
  const parts: string[] = []
  let inQuotes = false
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === ';') {
      parts.push(line.slice(start, i))
      start = i + 1
    }
  }
  parts.push(line.slice(start))
  return parts
}

/**
 * Subject for a segment, from its head tokens.
 *
 * `seta`/`setu`/`sets` count as `set` because the engine treats all four as
 * the same cvar assignment, and `config-parser.ts` classifies them together
 * too. `render.ts` only ever emits plain `set`, so this is robustness for
 * hand-built input rather than a widened contract.
 */
function subjectFor(tokens: Token[], fileName: string): FindingSubject {
  if (tokens.length >= 2) {
    const head = tokens[0].text.toLowerCase()
    if (CVAR_COMMANDS.has(head)) return { kind: 'cvar', id: tokens[1].text }
    if (head === 'bind') return { kind: 'bind', id: tokens[1].text }
    if (head === 'alias') return { kind: 'alias', id: tokens[1].text }
  }
  return { kind: 'file', id: fileName }
}

// ---------------------------------------------------------------------------
// Alias definitions and the reference graph they form
// ---------------------------------------------------------------------------

interface AliasDef {
  /** Name exactly as written, for display. */
  name: string
  /** Lower-cased name - the engine matches alias names case-insensitively. */
  key: string
  /** The body: the inner text when it was one quoted argument, the raw remainder otherwise. */
  body: string
  fileName: string
  /** 1-based physical line number within `fileName`. */
  line: number
}

/**
 * The defined alias `token` refers to, or `null`.
 *
 * Literal match first. Only when that fails is one leading `+`/`-` stripped
 * and tried again: `+foo`/`-foo` belong to the same alias family as `foo` (see
 * `alt-layers.ts`'s hold-layer naming), so a body calling `-drops` while only
 * `drops` is defined is still worth treating as an edge. Literal-first matters
 * - `alt-layers.ts` defines `+drops` and `-drops` as aliases in their own
 * right, and those must resolve to themselves rather than to a sign-stripped
 * neighbour that happens to share the name.
 */
function referencedAlias(token: string, defined: ReadonlySet<string>): string | null {
  const lower = token.toLowerCase()
  if (defined.has(lower)) return lower
  if ((lower.startsWith('+') || lower.startsWith('-')) && defined.has(lower.slice(1))) {
    return lower.slice(1)
  }
  return null
}

/** Key -> the keys of every alias that key's (last-wins) body dispatches, in body order, deduplicated. */
function buildEdges(defs: ReadonlyMap<string, AliasDef>): Map<string, string[]> {
  const defined = new Set(defs.keys())
  const edges = new Map<string, string[]>()

  for (const [key, def] of defs) {
    const refs: string[] = []
    for (const segment of splitTopLevelSemicolons(def.body)) {
      const tokens = tokenize(segment)
      if (tokens.length === 0) continue
      const ref = referencedAlias(tokens[0].text, defined)
      if (ref !== null && !refs.includes(ref)) refs.push(ref)
    }
    edges.set(key, refs)
  }

  return edges
}

/** Every node reachable from `start` by following one or more edges (`start` itself only via a cycle). */
function reachableFrom(start: string, edges: ReadonlyMap<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [...(edges.get(start) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop() as string
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of edges.get(node) ?? []) stack.push(next)
  }
  return seen
}

interface CycleAnalysis {
  /** Key -> the canonical (alphabetically first) key of the cycle it belongs to. */
  cyclicNodes: Map<string, string>
  /** Canonical key -> every member of that cycle, sorted. One entry per cycle. */
  membersByCanonical: Map<string, string[]>
}

/**
 * Groups aliases into cycles by mutual reachability: `a` and `b` sit on the
 * same cycle exactly when `a` reaches `b` and `b` reaches `a`, and `a` is on a
 * cycle at all exactly when it reaches itself - which also covers the
 * degenerate `alias loop loop` self-reference.
 *
 * That is the strongly-connected-component definition computed directly rather
 * than via Tarjan/Kosaraju: alias graphs are a few dozen nodes at most, and
 * the direct version is short enough to check by eye, which matters more here
 * than the asymptotics. Unlike a DFS back-edge search it does not depend on
 * where the walk started, so a ring that no root leads into (one floating
 * beside an unrelated chain) is still found, and each cycle is reported once
 * on its alphabetically first member instead of once per member.
 */
function analyzeCycles(edges: ReadonlyMap<string, string[]>): CycleAnalysis {
  const nodes = [...edges.keys()]
  const reachable = new Map<string, Set<string>>()
  for (const node of nodes) reachable.set(node, reachableFrom(node, edges))

  const cyclicNodes = new Map<string, string>()
  const membersByCanonical = new Map<string, string[]>()

  for (const node of nodes) {
    const from = reachable.get(node) as Set<string>
    if (!from.has(node)) continue // not on any cycle
    if (cyclicNodes.has(node)) continue // already grouped by an earlier member

    const members = nodes
      .filter((other) => from.has(other) && (reachable.get(other) as Set<string>).has(node))
      .sort()
    const canonical = members[0] as string
    membersByCanonical.set(canonical, members)
    for (const member of members) cyclicNodes.set(member, canonical)
  }

  return { cyclicNodes, membersByCanonical }
}

/**
 * Longest chain of nested alias dispatches starting at `node`, counting `node`
 * itself as the first dispatch, ignoring edges into a cyclic alias - that path
 * is already reported as a cycle, and following it would not terminate.
 * Memoized, so a shared tail is walked once.
 */
function longestChainFrom(
  node: string,
  edges: ReadonlyMap<string, string[]>,
  cyclicNodes: ReadonlyMap<string, string>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(node)
  if (cached !== undefined) return cached

  let deepest = 0
  for (const next of edges.get(node) ?? []) {
    if (cyclicNodes.has(next)) continue
    deepest = Math.max(deepest, longestChainFrom(next, edges, cyclicNodes, memo))
  }

  const result = 1 + deepest
  memo.set(node, result)
  return result
}

/**
 * The aliases a chain can actually *start* at: every non-cyclic alias that no
 * other non-cyclic alias references. That approximates "what a key bind would
 * trigger", and it is complete - if every non-cyclic alias had a non-cyclic
 * predecessor, following predecessors backwards would have to close into a
 * cycle, contradicting them all being non-cyclic. So every non-cyclic alias is
 * reachable from one of these, and measuring depth only from here yields one
 * finding per over-deep chain instead of one per alias along it.
 */
function chainRoots(
  edges: ReadonlyMap<string, string[]>,
  cyclicNodes: ReadonlyMap<string, string>,
): string[] {
  const referenced = new Set<string>()
  for (const [key, refs] of edges) {
    if (cyclicNodes.has(key)) continue
    for (const ref of refs) if (!cyclicNodes.has(ref)) referenced.add(ref)
  }
  return [...edges.keys()].filter((key) => !cyclicNodes.has(key) && !referenced.has(key))
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Structural findings for `files`, judged against `engine`.
 *
 * `files` is deliberately plain `{ name, content }` pairs rather than a
 * `ConfigProfile`: the caller (D5) hands over exactly what `render.ts`
 * produced, so a validated byte and a written byte can never disagree about
 * what they mean. Findings come back in a deterministic order - per file, its
 * size finding then its line findings top to bottom, then the alias findings
 * over the *combined* set of files (names, duplicates, cycles, depth), because
 * an alias defined in one file is perfectly able to collide with, or call, one
 * defined in another.
 */
export function validateStructure(files: readonly StructureFile[], engine: EngineKind): Finding[] {
  const limits: EngineLimits | undefined = limitsFor(engine)
  const findings: Finding[] = []
  let sequence = 0

  const add = (
    rule: string,
    level: Finding['level'],
    subject: FindingSubject,
    params: Record<string, string | number>,
    source: string,
  ): void => {
    findings.push({
      // Unique and stable within one run, and prefixed with the engine so
      // D5's per-engine sections cannot collide on a React key.
      id: `${engine}:structure:${rule}:${sequence++}`,
      level,
      engine,
      messageKey: `${STRUCTURE_MESSAGE_PREFIX}${rule}`,
      params,
      subject,
      source,
    })
  }

  const aliasDefs: AliasDef[] = []

  for (const file of files) {
    // --- Total file size ---------------------------------------------------
    // `content.length` is the latin1 byte count (see `latin1ByteLength`), and
    // the full text goes in as `content` so q2pro is judged on the bytes it
    // actually measures: COM_Compress strips comments and collapses runs of
    // whitespace before the comparison, so a heavily commented file costs it
    // far less than the file system shows. r1q2 and vanilla are judged on the
    // raw count. `evaluateSize` returns `undefined` for an engine with no
    // source-cited budget, and then nothing is reported at all.
    const budget = evaluateSize(latin1ByteLength(file.content), engine, file.content)
    if (budget && budget.level !== 'ok') {
      const sizeParams = {
        file: file.name,
        // What the engine compares against its limit: compressed bytes for
        // q2pro, raw bytes elsewhere. `rawBytes` is always the on-disk size,
        // so a message can show both without a second lookup.
        bytes: budget.effectiveBytes,
        rawBytes: budget.bytes,
        limit: budget.limit,
        percent: Math.round(budget.ratio * 100),
      }
      // A total mapping over the two engine facts that decide the wording, so
      // no engine ever borrows another's consequence. Compressed measurement
      // currently only ever occurs together with whole-file rejection (q2pro's
      // EFBIG), but the truncating variant is spelled out rather than folded
      // into the raw one: a fallback there would tell a user their file is cut
      // off at a byte count the engine never even looked at.
      const overRule = budget.sizeCountsAfterCompression
        ? budget.overflowDiscardsWholeFile
          ? 'sizeOverCompressedDiscarded'
          : 'sizeOverCompressedTruncated'
        : budget.overflowDiscardsWholeFile
          ? 'sizeOverDiscarded'
          : 'sizeOverTruncated'

      if (budget.level === 'over') {
        add(overRule, 'error', { kind: 'file', id: file.name }, sizeParams, SOURCE.size)
      } else {
        const warnRule = budget.sizeCountsAfterCompression ? 'sizeWarnCompressed' : 'sizeWarn'
        add(warnRule, 'warning', { kind: 'file', id: file.name }, sizeParams, SOURCE.size)
      }
    }

    // --- Per line ----------------------------------------------------------
    // Split on `\n` only: the writer emits `\n`, and leaving a stray `\r`
    // inside the line is the honest thing for a length check, since the
    // engine's line buffer would have to hold that byte too.
    file.content.split('\n').forEach((rawLine, index) => {
      const line = index + 1
      const active = stripLineComment(rawLine)
      const segments = splitTopLevelSemicolons(active)

      // The line's subject comes from its first command, so an over-long `set`
      // line points at the cvar rather than at the file.
      if (limits && latin1ByteLength(rawLine) >= limits.maxLineBytes) {
        add(
          'lineTooLong',
          'error',
          subjectFor(tokenize(segments[0] ?? ''), file.name),
          { file: file.name, line, bytes: latin1ByteLength(rawLine), limit: limits.maxLineBytes },
          SOURCE.line,
        )
      }

      for (const segment of segments) {
        const tokens = tokenize(segment)
        if (tokens.length === 0) continue

        // --- Quoting -------------------------------------------------------
        // Only a segment whose value position opens with a `"` is meant to be
        // one quoted argument (`set <name> "<value>"`, `bind <key> "<value>"`,
        // `alias <name> "<body>"`). For those, exactly two quote characters -
        // the opener and its closer - is the only correct shape: Quake II has
        // no escape character inside a quoted string, so the first `"` after
        // the opening one always closes it and every further `"` spills the
        // remainder of the line back out as stray commands (and can
        // desynchronize the lines after it, since the file is scanned as one
        // character stream). Anything other than two - three because the value
        // contained one, or one because the closer went missing - is that same
        // corruption. Deliberately line-local rather than a full re-tokenize:
        // the three shapes above are the only ones `render.ts` produces.
        if (tokens.length >= 2) {
          const rest = segment.slice(tokens[1].end).trimStart()
          if (rest.startsWith('"')) {
            let quotes = 0
            for (const ch of rest) if (ch === '"') quotes++
            if (quotes !== 2) {
              add(
                'quoteBroken',
                'error',
                subjectFor(tokens, file.name),
                { file: file.name, line, quotes },
                SOURCE.quote,
              )
            }
          }
        }

        // --- Alias definitions ---------------------------------------------
        if (tokens[0].text.toLowerCase() === 'alias' && tokens.length >= 2) {
          const nameToken = tokens[1]
          const rest = segment.slice(nameToken.end).trim()
          // A quoted body is one token; an unquoted one is the raw remainder,
          // which keeps any `;` that separates its commands intact.
          const body = tokens.length > 2 ? (rest.startsWith('"') ? tokens[2].text : rest) : ''
          aliasDefs.push({
            name: nameToken.text,
            key: nameToken.text.toLowerCase(),
            body,
            fileName: file.name,
            line,
          })
        }
      }
    })
  }

  // --- Alias names and duplicates ------------------------------------------
  // `maxAliasNameLength`/`aliasLoopCount` come from the resolved limits when
  // there are any, and otherwise from the shared `cmd.c` constants - see this
  // module's header for why that is not "falling back to r1q2".
  const maxAliasName = limits?.maxAliasNameLength ?? MAX_ALIAS_NAME
  const aliasLoopCount = limits?.aliasLoopCount ?? ALIAS_LOOP_COUNT

  const firstDefs = new Map<string, AliasDef>()
  const effectiveDefs = new Map<string, AliasDef>()

  for (const def of aliasDefs) {
    if (firstDefs.has(def.key)) {
      add(
        'aliasDuplicate',
        'error',
        { kind: 'alias', id: def.name },
        { name: def.name, file: def.fileName, line: def.line },
        SOURCE.aliasReplace,
      )
    } else {
      firstDefs.set(def.key, def)
    }
    // The later definition is the one that takes effect, so its body is what
    // the reference graph below has to be built from.
    effectiveDefs.set(def.key, def)
  }

  // Name rules are reported once per distinct name, on its first definition -
  // a name that is both too long and defined twice is one naming problem plus
  // one duplication problem, not the same complaint twice.
  for (const def of firstDefs.values()) {
    if (def.name.length >= maxAliasName) {
      add(
        'aliasTooLong',
        'error',
        { kind: 'alias', id: def.name },
        { name: def.name, length: def.name.length, max: maxAliasName - 1 },
        SOURCE.aliasName,
      )
    }
    if (WHITESPACE.test(def.name)) {
      add(
        'aliasSpace',
        'error',
        { kind: 'alias', id: def.name },
        { name: def.name, file: def.fileName, line: def.line },
        SOURCE.aliasName,
      )
    }
  }

  // --- Alias cycles and expansion depth ------------------------------------
  const edges = buildEdges(effectiveDefs)
  const { cyclicNodes, membersByCanonical } = analyzeCycles(edges)

  for (const [canonical, members] of membersByCanonical) {
    const def = effectiveDefs.get(canonical) as AliasDef
    const names = members.map((key) => (effectiveDefs.get(key) as AliasDef).name)
    add(
      'aliasCycle',
      'error',
      { kind: 'alias', id: def.name },
      // The chain closes back on its first member, so the loop is visible in
      // the message rather than merely asserted.
      { name: def.name, chain: [...names, names[0]].join(' -> '), max: aliasLoopCount },
      SOURCE.aliasLoop,
    )
  }

  // `Cmd_ExecuteString` counts every alias body it dispatches within one
  // `Cbuf_Execute` pass and refuses to go deeper than `ALIAS_LOOP_COUNT`, so
  // everything past the cut-off of an over-long chain is dropped. The
  // threshold is `> aliasLoopCount` rather than `>=`: the engine's own counter
  // is checked as `++alias_count == ALIAS_LOOP_COUNT`, which strictly means
  // the 16th dispatch is already refused, but erring one notch permissive here
  // means a chain the engine does run is never reported as broken.
  const depthMemo = new Map<string, number>()
  for (const root of chainRoots(edges, cyclicNodes)) {
    const depth = longestChainFrom(root, edges, cyclicNodes, depthMemo)
    if (depth > aliasLoopCount) {
      const def = effectiveDefs.get(root) as AliasDef
      add(
        'aliasDepth',
        'error',
        { kind: 'alias', id: def.name },
        { name: def.name, depth, max: aliasLoopCount },
        SOURCE.aliasLoop,
      )
    }
  }

  return findings
}
