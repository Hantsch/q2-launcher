/**
 * The Care tab's tidy-up analyzer — story 025 D4.
 *
 * One pure function, `analyzeTidyUp`, that turns a profile into the flat
 * maintenance list the Care tab's tidy-up section shows: every finding carries
 * the machine-readable `TidyUpOp`s (D3, `@shared/config/tidy-up`) that would fix
 * it, so the UI (D5/D6) only ever renders findings and posts ops back - it never
 * derives a fix itself.
 *
 * Lives in `renderer/.../lib` rather than in `src/shared`, same reason
 * `validation-scope.ts` does: it composes a renderer-side helper
 * (`./bind-conflicts`, which `src/shared` may not import) with shared
 * validators. Pure all the same - no DOM, no hooks, no IPC - so a vitest file
 * imports it directly.
 *
 * ## The four sources, and the three modes (decision 11)
 *
 * `mode` is *not* a severity, it is who is allowed to decide:
 *
 * - `'auto'` - the fix is provably inert: applying it cannot change what the
 *   engine does. Exactly two kinds qualify, a shadowed (dead) bind claim and an
 *   empty layer, and both are `'auto'` only when that proof actually holds -
 *   see `resolveWinner` below.
 * - `'review'` - there is a fix, but which fix is the user's call (drop a
 *   preserved line or promote it; delete an alias nothing calls).
 * - `'report'` - surfaced with no op at all, because inventing one would be a
 *   judgement call this module has no basis for (an undefined alias reference:
 *   removing the bind and writing the missing alias are equally valid).
 *
 * Invariant, deliberately: `mode === 'auto'` implies `ops.length > 0`. An
 * "automatic" row with no op would be a button that does nothing.
 *
 * ## Which claim of a contested key actually *wins*
 *
 * This is the whole risk in this file. `findBindConflicts` reports *display
 * names*, which is enough for a badge and not nearly enough to fix anything: a
 * `removeShadowedBind` op has to name one specific claim, and naming the wrong
 * one deletes the binding that works and keeps the dead one - a change that
 * looks right in the UI (the conflict clears) and is silently wrong in-game.
 *
 * So the winner is never guessed from claim order or from array order. It is
 * read back out of what the writer already produced, because "who wins" is a
 * property of the *rendered file*, and the engine's rule is simply that the last
 * `bind <key>` it reads for a key wins:
 *
 * - **base scope**: `renderProfileFile` (`@shared/config/render`) emits
 *   `profile.binds` as `bind <key> "<command>"` in `Object.keys(binds).sort()`
 *   order and nothing else ever emits a base bind. So the winning command for a
 *   key is the value of the *last-sorted* `binds` entry that normalizes to it -
 *   not "the entry on the normalized spelling", which is only the same thing
 *   when there is one entry. An import legitimately leaves two spellings of one
 *   key (`{ MOUSE1: '+attack', mouse1: 'weapnext' }`, `import-reader.ts` keeps
 *   key names verbatim), and there `mouse1` sorts last and its command is what
 *   the player actually gets - even though the `MOUSE1` entry is the one an
 *   `applyActionBindMirror` pass would have written.
 * - **layer scope**: `generateLayerAliases` emits one `bind <key> <command>` per
 *   override in `Object.entries(layer.overrides)` order, joined into one alias
 *   body, so the winner is the *last* non-blank override entry normalizing to
 *   that key (insertion order, not sorted - a plain object assignment to an
 *   existing key keeps its original position, and `applyActionLayerMirror`
 *   appends only genuinely new normalized keys).
 *
 * That command is then attributed back to a claim by value: an action claim
 * renders as `bindValueFor(action)` (the exact value both mirrors write), a
 * `baseBind`/`layerOverride` claim renders as its own command. Every *other*
 * claim is a loser and gets one op. When the winning command cannot be
 * attributed to any claim, or attributes to two different actions at once, this
 * module emits **no ops** for that conflict and reports it as `'report'`
 * instead: `'auto'`'s entire basis is that removing a loser is provably inert,
 * and that proof does not exist without a known winner.
 *
 * The claim list itself is `bindClaimsFor` (`@shared/config/tidy-up`), the same
 * function D3's applier re-checks against, so the claim an op names cannot drift
 * from the claim that op is validated against - the one thing a third copy of
 * "who claims this key" would have risked.
 */

import { bindValueFor } from '@shared/config/action-mirror'
import { sanitizeCommand, generateLayerAliases } from '@shared/config/alt-layers'
import { findBindCollision } from '@shared/config/bind-collision'
import { tokenizeConfigText, type ConfigSyntaxToken } from '@shared/config/config-syntax'
import { findCvar } from '@shared/config/cvar-catalog'
import { normalizeBindKey } from '@shared/config/key-names'
import {
  bindClaimsFor,
  type TidyUpBindClaim,
  type TidyUpBindScope,
  type TidyUpOp,
  type TidyUpReclassifyTarget,
} from '@shared/config/tidy-up'
import { ACTIONS_MESSAGE_PREFIX, validateActions } from '@shared/config/validate-actions'
import type { Finding } from '@shared/config/validation'
import type { ConfigProfile, UnrecognizedConfigLine } from '@shared/modules/config'
import type { EngineKind } from '@shared/types/engine'
import { findBindConflicts, type BindConflict } from './bind-conflicts'

/** Shared prefix of every message key this module emits, alongside the
 * validators' own `config.validation.*` (which stay untouched - the report and
 * this list phrase the same underlying facts differently, because one explains
 * a problem and the other offers to fix it). */
export const TIDY_UP_MESSAGE_PREFIX = 'config.care.tidyUp.'

/**
 * `validateActions` needs an `EngineKind` for `Finding.engine`, and its
 * alias-wiring rules "carry no engine-specific facts" (its own doc comment), so
 * this runs **once** with one fixed value - unlike `validation-scope.ts`, which
 * runs the story-009 report once per assigned engine. A tidy-up list is flat
 * maintenance work on one profile, not a per-engine report: looping per engine
 * would offer the same removal twice for a profile assigned to two engines.
 */
const TIDY_UP_ENGINE: EngineKind = 'r1q2'

/** Who decides - see the file doc comment. Never a severity; that is `level`. */
export type TidyUpFindingMode = 'auto' | 'review' | 'report'

/** What a row *is*, for the UI to group and label by without parsing
 * `messageKey`. One member per source rule, not one per message. */
export type TidyUpFindingKind =
  | 'shadowedBind'
  | 'emptyLayer'
  | 'unreferencedAlias'
  | 'undefinedAlias'
  | 'duplicateAlias'
  | 'preservedLine'

/** One row of the Care tab's tidy-up list. */
export interface TidyUpFinding {
  /** Stable and deterministic across runs on an unchanged profile (never
   * random, never index-only), so the UI can key on it and a pending row
   * survives a re-scan. */
  id: string
  kind: TidyUpFindingKind
  mode: TidyUpFindingMode
  /** Same two levels the validators use for these rules; `info` never occurs
   * here, since a tidy-up row always describes something worth removing. */
  level: 'error' | 'warning'
  /** i18n key under `TIDY_UP_MESSAGE_PREFIX`. Never literal prose. */
  messageKey: string
  params: Record<string, string | number>
  /** The fixes offered for this row, in the order the UI should offer them.
   * Empty for `'report'`; several when the user picks between them (a preserved
   * line offers drop *and* promote). */
  ops: TidyUpOp[]
  /** The id of the underlying finding this row was derived from - the real
   * `Finding.id` where a validator produced one, a minted stable id where the
   * source has none (`findBindConflicts`, `layer.empty`, a preserved line). D8
   * de-duplicates the tab badge across the validation report and this list by
   * this field, so it is deterministic rather than unique-per-row. */
  sourceFindingId: string
  /** The `ConfigAction.id` this finding names, when it names one at all - story
   * 058 D5's "Show in Controls" deep link is wired off this. Only
   * `shadowedBind` ever sets it today (see `shadowedBindActionId` below); every
   * other kind names a key with no owning action, an alias, or a layer/line,
   * none of which are a Controls row. */
  actionId?: string
}

function scopeId(scope: TidyUpBindScope): string {
  return scope === 'base' ? 'base' : scope.layerId
}

/** `Finding.level` narrowed to the two levels a tidy-up row can carry - the
 * source's own level, never a second opinion about severity. */
function findingLevel(level: Finding['level']): 'error' | 'warning' {
  return level === 'error' ? 'error' : 'warning'
}

/**
 * The command the rendered file actually leaves in effect for `normalizedKey` in
 * `scope` - "the last `bind <key>` the engine reads", derived from the exact
 * emission order the writers use. See the file doc comment for why this is read
 * back out of the rendered order rather than taken from
 * `binds[normalizedKey]`/`overrides[normalizedKey]`.
 *
 * `undefined` when nothing is stored for that key at all (a profile whose mirror
 * has not run yet, which no write path produces but a hand-built one can) - the
 * caller then proves no winner and offers no op.
 */
function effectiveCommand(
  profile: ConfigProfile,
  scope: TidyUpBindScope,
  normalizedKey: string,
): string | undefined {
  if (scope === 'base') {
    const matching = Object.keys(profile.binds)
      .filter((rawKey) => normalizeBindKey(rawKey) === normalizedKey && profile.binds[rawKey])
      .sort()
    const last = matching[matching.length - 1]
    return last === undefined ? undefined : profile.binds[last]
  }

  const layer = (profile.layers ?? []).find((candidate) => candidate.id === scope.layerId)
  if (!layer) return undefined

  let effective: string | undefined
  for (const [rawKey, command] of Object.entries(layer.overrides)) {
    if (normalizeBindKey(rawKey) !== normalizedKey) continue
    // A blank override is not an override - `generateLayerAliases` filters it
    // out before it emits anything, so it can never be what wins.
    if (sanitizeCommand(command ?? '').length === 0) continue
    effective = command
  }
  return effective
}

/** The value this claim renders as: the mirror value for an action slot (the
 * exact string both mirror passes write), the command itself for a hand-made
 * entry. `undefined` only if the action vanished, which `bindClaimsFor` rules
 * out - narrowing. */
function claimRenderedValue(profile: ConfigProfile, claim: TidyUpBindClaim): string | undefined {
  if (claim.source !== 'action') return claim.command
  const action = (profile.actions ?? []).find((candidate) => candidate.id === claim.actionId)
  return action ? bindValueFor(action) : undefined
}

/** A claim's display name, matching what `findBindConflicts` puts in `owners` -
 * so the message can name the survivor in the same words the conflict badge
 * uses. */
function claimOwnerName(profile: ConfigProfile, claim: TidyUpBindClaim): string {
  if (claim.source !== 'action') return claim.command
  const action = (profile.actions ?? []).find((candidate) => candidate.id === claim.actionId)
  return action?.name ?? claim.actionId
}

/**
 * The index in `claims` of the claim that is currently in effect, or `undefined`
 * when that cannot be *proved*.
 *
 * Attribution is by rendered value against `effectiveCommand`. Three outcomes
 * beyond the plain one-match case, all deliberate:
 *
 * - **two or more action claims render the winning value.** No winner. Two
 *   actions can only share a rendered value by sharing an alias name (which is
 *   `aliasDuplicate`, reported separately) or a catalogue `+command`, and in
 *   that state D3's removal strips base-bind mirror entries *by value*, so
 *   removing "the loser" would take the survivor's own mirror entry with it and
 *   leave the key unbound until the next save. Not inert, so not offered.
 * - **several hand-made claims render it** (the two-spellings-of-one-key import,
 *   or two byte-identical entries). The last-rendered one is the winner and the
 *   others are losers; since their commands are identical, whichever entry D3's
 *   first-match removal actually drops renders the same line either way, so this
 *   stays inert.
 * - **nothing renders it.** No winner - the stored value belongs to no claimant
 *   (e.g. a mirror of an action that has since moved to another key). Reported,
 *   not fixed.
 */
function resolveWinner(
  profile: ConfigProfile,
  scope: TidyUpBindScope,
  normalizedKey: string,
  claims: TidyUpBindClaim[],
): number | undefined {
  const effective = effectiveCommand(profile, scope, normalizedKey)
  if (effective === undefined) return undefined

  const matches: number[] = []
  claims.forEach((claim, index) => {
    const value = claimRenderedValue(profile, claim)
    if (value === undefined) return
    // Compared against the trimmed stored value as well, the same tolerance
    // D3's own mirror strip applies (`withoutMirrorEntries`).
    if (value === effective || value === effective.trim()) matches.push(index)
  })
  if (matches.length === 0) return undefined

  const actionMatches = matches.filter((index) => claims[index]!.source === 'action')
  if (actionMatches.length > 1) return undefined
  if (actionMatches.length === 1) return actionMatches[0]
  return matches[matches.length - 1]
}

/**
 * The `ConfigAction.id` to offer "Show in Controls" for, given a contested
 * key's claims and its (possibly unproven) winner - story 058 D5.
 *
 * When a winner is proven, the row is about the claim that lost: pointing
 * "Show in Controls" at the winner would land on the row that already works,
 * not the one the user actually needs to look at. So this reads the *losing*
 * claims first and takes the first one that names an action; a conflict
 * between two hand-made entries (no action involved at all) offers no link.
 *
 * Without a proven winner (the `'report'` mode), there is no losing/winning
 * split to prefer, so this takes the first action claim among all of them -
 * still "an" entry worth looking at, even though which one is at fault is
 * exactly what could not be proven.
 */
function shadowedBindActionId(claims: TidyUpBindClaim[], winner: number | undefined): string | undefined {
  const candidates = winner === undefined ? claims : claims.filter((_claim, index) => index !== winner)
  const found = candidates.find((claim) => claim.source === 'action')
  return found?.source === 'action' ? found.actionId : undefined
}

/**
 * One finding per key `findBindConflicts` reports as contested, with a
 * `removeShadowedBind` op for every claim that is *not* the one in effect.
 *
 * The scan stays the authority on "is this key contested" (it is the same scan
 * the Controls grid's badges come from, so this list and those badges can never
 * disagree about what a conflict is); this function only answers "which of them
 * wins" and "who exactly are they".
 */
function shadowedBindFindings(profile: ConfigProfile): TidyUpFinding[] {
  return findBindConflicts(profile).map((conflict: BindConflict): TidyUpFinding => {
    const normalizedKey = normalizeBindKey(conflict.key)
    const claims = bindClaimsFor(profile, conflict.scope, normalizedKey)
    const winner = claims.length >= 2 ? resolveWinner(profile, conflict.scope, normalizedKey, claims) : undefined
    const id = `${scopeId(conflict.scope)}:${conflict.key}`

    const shared = {
      id: `shadowedBind:${id}`,
      kind: 'shadowedBind' as const,
      level: 'warning' as const,
      sourceFindingId: `bindConflict:${id}`,
    }

    if (winner === undefined) {
      // No provable winner: removing any claim could be the one thing that
      // actually works, so nothing is offered and the row only reports. Keeping
      // it `'auto'` with an empty `ops` array would promise a fix that is not
      // there; keeping it `'auto'` *with* ops would guess.
      return {
        ...shared,
        mode: 'report' as const,
        messageKey: `${TIDY_UP_MESSAGE_PREFIX}shadowedBindUnresolved`,
        params: { key: conflict.key, owners: conflict.owners.join(', '), count: conflict.owners.length },
        ops: [],
        actionId: shadowedBindActionId(claims, winner),
      }
    }

    const ops: TidyUpOp[] = claims
      .filter((_claim, index) => index !== winner)
      .map((claim) => ({
        kind: 'removeShadowedBind' as const,
        scope: conflict.scope,
        key: conflict.key,
        claim,
      }))

    return {
      ...shared,
      mode: 'auto' as const,
      messageKey: `${TIDY_UP_MESSAGE_PREFIX}shadowedBind`,
      params: {
        key: conflict.key,
        owners: conflict.owners.join(', '),
        count: conflict.owners.length,
        winner: claimOwnerName(profile, claims[winner]!),
      },
      ops,
      actionId: shadowedBindActionId(claims, winner),
    }
  })
}

/**
 * One finding per layer whose every override is blank - "empty" asked of
 * `generateLayerAliases` itself (its own `layer.empty` issue), never re-derived,
 * so this can never disagree with the generator, and neither can D3's applier,
 * which re-checks the very same issue.
 */
function emptyLayerFindings(profile: ConfigProfile): TidyUpFinding[] {
  const findings: TidyUpFinding[] = []
  for (const layer of profile.layers ?? []) {
    const { issues } = generateLayerAliases(layer, profile.binds)
    const issue = issues.find((candidate) => candidate.key === 'layer.empty')
    if (!issue) continue
    findings.push({
      id: `emptyLayer:${layer.id}`,
      kind: 'emptyLayer',
      mode: 'auto',
      level: findingLevel(issue.level),
      messageKey: `${TIDY_UP_MESSAGE_PREFIX}emptyLayer`,
      params: { name: layer.name },
      ops: [{ kind: 'removeEmptyLayer', layerId: layer.id }],
      sourceFindingId: `layerEmpty:${layer.id}`,
    })
  }
  return findings
}

/**
 * The alias-wiring half, from `validateActions`' own findings - one tidy-up row
 * per finding, keeping the validator's id (so D8 can de-duplicate against the
 * report) and its level.
 *
 * Only `aliasUnreferenced` gets an op. Its `Finding.subject.id` is the action's
 * `name`, not its `ConfigAction.id` (that rule's `add()` call passes
 * `action.name`), so the real id is resolved by matching the alias rows on that
 * name - and a name shared by two alias rows resolves to *nothing*: which of
 * them to delete is unknowable from here, and picking "the first match" would
 * delete a row the user never pointed at. Such a profile also raises
 * `aliasDuplicate`, which is where that state actually gets explained.
 */
function aliasFindings(profile: ConfigProfile): TidyUpFinding[] {
  const actions = profile.actions ?? []
  const findings = validateActions(actions, TIDY_UP_ENGINE, {
    binds: profile.binds,
    layers: profile.layers,
  })

  const rows: TidyUpFinding[] = []
  for (const finding of findings) {
    const params = finding.params ?? {}
    const level = findingLevel(finding.level)

    if (finding.messageKey === `${ACTIONS_MESSAGE_PREFIX}aliasUnreferenced`) {
      const subject = finding.subject
      const reportedName = subject.kind === 'action' ? subject.id : undefined
      const named = actions.filter(
        (action) => action.kind === 'alias' && action.name === reportedName,
      )
      const ops: TidyUpOp[] =
        named.length === 1 ? [{ kind: 'removeUnreferencedAlias', actionId: named[0]!.id }] : []
      rows.push({
        id: `unreferencedAlias:${finding.id}`,
        kind: 'unreferencedAlias',
        mode: 'review',
        level,
        messageKey: `${TIDY_UP_MESSAGE_PREFIX}unreferencedAlias`,
        params,
        ops,
        sourceFindingId: finding.id,
      })
      continue
    }

    if (finding.messageKey === `${ACTIONS_MESSAGE_PREFIX}undefinedAlias`) {
      // No op: removing the bind and writing the missing alias are equally
      // valid readings of the same broken wiring, and this module cannot tell
      // which the user meant.
      rows.push({
        id: `undefinedAlias:${finding.id}`,
        kind: 'undefinedAlias',
        mode: 'report',
        level,
        messageKey: `${TIDY_UP_MESSAGE_PREFIX}undefinedAlias`,
        params,
        ops: [],
        sourceFindingId: finding.id,
      })
      continue
    }

    if (finding.messageKey === `${ACTIONS_MESSAGE_PREFIX}aliasDuplicate`) {
      // No op either: both rows are real entries the user made, and only they
      // know which one they meant to keep.
      rows.push({
        id: `duplicateAlias:${finding.id}`,
        kind: 'duplicateAlias',
        mode: 'report',
        level,
        messageKey: `${TIDY_UP_MESSAGE_PREFIX}duplicateAlias`,
        params,
        ops: [],
        sourceFindingId: finding.id,
      })
    }
  }
  return rows
}

/** Command names (case-insensitive) that assign a cvar - `config-parser.ts`'s
 * own `CVAR_COMMANDS` set, which is what decided this line was unrecognized in
 * the first place. */
const CVAR_COMMANDS = new Set(['set', 'seta', 'setu', 'sets'])

/** A token's text with a `string` token's own quotes removed - the tokenizer is
 * lossless and keeps them, `config-parser.ts`'s `tokenize` drops them, and it is
 * the latter's value that a profile field holds. */
function wordText(token: ConfigSyntaxToken): string {
  if (token.kind !== 'string') return token.text
  const withoutOpen = token.text.startsWith('"') ? token.text.slice(1) : token.text
  return withoutOpen.endsWith('"') ? withoutOpen.slice(0, -1) : withoutOpen
}

/**
 * What a preserved line would become, or `undefined` when this module will not
 * say.
 *
 * `PreservedLinesPanel.tsx` has no classification heuristic to reuse - it
 * renders the text verbatim, on purpose - so the reasoning is taken from the
 * parser that produced the line instead (`main/.../core/config-parser.ts`): a
 * line is preserved precisely because that parser could not classify it, so the
 * only lines this can promote are ones whose shape that parser's own rules
 * recognise but its command list does not. Tokenizing is
 * `tokenizeConfigText` (`@shared/config/config-syntax`), which is the same
 * quote/`;`/`//` handling as the parser's and is the one tokenizer the renderer
 * is allowed to reach (the parser itself lives in `main`).
 *
 * Three shapes, all conservative, everything else drop-only:
 *
 * - `set|seta|setu|sets <name> <value>` and `bind <key> <command>`: today's
 *   importer classifies both, so these only reach `unrecognized` by another
 *   route (a `;`-mixed line's sibling segment, a hand-edited `state.json`, an
 *   older import). Recognised anyway, because the meaning is not in doubt.
 * - a bare `<name> <value>` console-form assignment (`cl_run 1`,
 *   `sensitivity 4.5`) - the shape real hand-written configs are full of and the
 *   parser deliberately does not guess at. Only when `findCvar` knows the name:
 *   the catalog is what makes this a fact rather than a guess (`say hello` and
 *   `echo hi` are the same shape), and the *catalog's* spelling is what gets
 *   written, so a promoted row is the one the Settings tab already edits.
 *
 * Never an `actions` target. An `alias <name> "<body>"` line is the commonest
 * classifiable preserved line of all, and promoting one needs a category to file
 * it under (`ConfigAction.categoryId`, which D3 requires to resolve) plus an id
 * - a drawer decision the Controls editor makes with the user, not something a
 * scanner should pick for them. That also keeps this module clear of D3's
 * refusal for modifier-carrying action targets by construction: it emits no
 * action target at all.
 *
 * Also drop-only when D3 would refuse the write anyway (the cvar is already set
 * to something else, the key is already taken): offering a button whose only
 * possible outcome is `rejected` is worse than offering just the drop.
 */
function classifyPreservedLine(
  profile: ConfigProfile,
  text: string,
): TidyUpReclassifyTarget | undefined {
  const [line] = tokenizeConfigText(text)
  if (!line) return undefined

  const tokens = line.tokens.filter((token) => token.kind !== 'space')
  // A `;`-joined line is several commands and a trailing comment carries text
  // that promoting would silently drop - neither is classified.
  if (tokens.some((token) => token.kind === 'separator' || token.kind === 'comment')) {
    return undefined
  }

  const head = tokens[0]
  if (!head) return undefined
  const command = head.kind === 'command' ? head.text.toLowerCase() : undefined

  if (tokens.length === 3 && command && CVAR_COMMANDS.has(command)) {
    return cvarTarget(profile, wordText(tokens[1]!), wordText(tokens[2]!))
  }

  if (tokens.length === 3 && command === 'bind') {
    return bindTarget(profile, wordText(tokens[1]!), wordText(tokens[2]!))
  }

  if (tokens.length === 2 && head.kind === 'text') {
    const known = findCvar(head.text)
    return known ? cvarTarget(profile, known.name, wordText(tokens[1]!)) : undefined
  }

  return undefined
}

/** A cvar target, unless the profile already holds a different value for that
 * name - promoting must never overwrite content the user has (D3 refuses it
 * too). */
function cvarTarget(
  profile: ConfigProfile,
  name: string,
  value: string,
): TidyUpReclassifyTarget | undefined {
  if (name.length === 0) return undefined
  const existing = profile.cvars[name]
  if (existing !== undefined && existing !== value) return undefined
  return { field: 'cvars', name, value }
}

/** A base-bind target, unless the key is already claimed by something other
 * than this exact command. `findBindCollision` answers "is the key free", the
 * same function D3's own precondition uses; a layer override is not a blocker
 * (decision 14). */
function bindTarget(
  profile: ConfigProfile,
  key: string,
  command: string,
): TidyUpReclassifyTarget | undefined {
  if (key.length === 0 || sanitizeCommand(command).length === 0) return undefined
  const collision = findBindCollision(profile, key)
  if (collision && collision.kind !== 'layerOverride') {
    if (collision.kind !== 'baseBind' || collision.command !== command) return undefined
  }
  return { field: 'binds', key: normalizeBindKey(key), command }
}

/**
 * One `'review'` finding per preserved line, always offering
 * `dropPreservedLine` and additionally `reclassifyPreservedLine` when
 * `classifyPreservedLine` will commit to a target. Both ops sit in the same
 * finding: D5 renders them as two buttons on one row, so the user chooses
 * between forgetting the line and keeping it, rather than being shown the same
 * line twice.
 */
function preservedLineFindings(profile: ConfigProfile): TidyUpFinding[] {
  const lines: UnrecognizedConfigLine[] = profile.unrecognized ?? []
  return lines.map((entry, index) => {
    const ops: TidyUpOp[] = [
      { kind: 'dropPreservedLine', file: entry.file, line: entry.line, text: entry.text },
    ]
    const target = classifyPreservedLine(profile, entry.text)
    if (target) {
      ops.push({
        kind: 'reclassifyPreservedLine',
        file: entry.file,
        line: entry.line,
        text: entry.text,
        target,
      })
    }

    const params: Record<string, string | number> = {
      file: entry.file,
      line: entry.line,
      text: entry.text,
    }
    let messageKey = `${TIDY_UP_MESSAGE_PREFIX}preservedLine`
    if (target?.field === 'cvars') {
      messageKey = `${TIDY_UP_MESSAGE_PREFIX}preservedLineCvar`
      params['name'] = target.name
      params['value'] = target.value
    } else if (target?.field === 'binds') {
      messageKey = `${TIDY_UP_MESSAGE_PREFIX}preservedLineBind`
      params['key'] = target.key
      params['command'] = target.command
    }

    return {
      // A `;`-mixed line can preserve two segments carrying the *same* line
      // number, so the array index is part of the row's own id - while
      // `sourceFindingId` stays the file/line pair D8 de-duplicates on.
      id: `preserved:${entry.file}:${entry.line}:${index}`,
      kind: 'preservedLine' as const,
      mode: 'review' as const,
      level: 'warning' as const,
      messageKey,
      params,
      ops,
      sourceFindingId: `preserved:${entry.file}:${entry.line}`,
    }
  })
}

/**
 * Every tidy-up row `profile` currently has, in a fixed source order - shadowed
 * binds, empty layers, alias wiring, preserved lines - so the list a user sees
 * does not reshuffle between two scans of the same profile.
 *
 * Pure: reads `profile`, calls the same validators the report uses, returns
 * data. No clock, no ids, no I/O - which is what lets D5 call it on every
 * render and a test call it directly.
 */
export function analyzeTidyUp(profile: ConfigProfile): TidyUpFinding[] {
  return [
    ...shadowedBindFindings(profile),
    ...emptyLayerFindings(profile),
    ...aliasFindings(profile),
    ...preservedLineFindings(profile),
  ]
}
