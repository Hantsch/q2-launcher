/**
 * A small, committed corpus of `ConfigProfile`s covering the shapes story
 * 038's writer has to get right (story 038 D3, plan step 4).
 *
 * Why a corpus module instead of data inside a `.test.ts` (Decisions
 * (Sprint)): `fast-check` would be a new dev dependency plus a generator
 * design this repo has no second use for, while a plain module is importable
 * by more than one test file - vitest's include pattern
 * (`src/**\/*.{test,spec}.ts`) makes a `.test.ts` file importable only by
 * accident, and 040/042 render these same profiles.
 *
 * Types only - no `fs`, no DOM, no electron - so this obeys the same
 * `src/shared` contract as `render.ts`/`alias-references.ts` themselves.
 *
 * Each exported profile below is named after the shape it exists to cover
 * (see `render-invariants.test.ts`, which asserts AC4's file-level invariant
 * over every one of them); `PROFILE_FIXTURES` is the same set keyed by name,
 * for a caller that wants to iterate the whole corpus rather than name one
 * profile at a time.
 *
 * Two of them sit in a second set, `SELF_REFERENCE_FIXTURES`, instead: since the
 * User's decision in story 039 the writer *keeps* a multi-command alias line
 * that calls its own name, so those two profiles are expected to produce
 * findings and cannot live in a corpus asserted to produce none. See the comment
 * above them.
 */

import type { ConfigAction, ConfigProfile } from '../modules/config'
import type { AltLayer } from './alt-layers'
import { aliasNameFor } from './alias-render'
import { bindValueFor } from './action-mirror'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function baseProfile(id: string, overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id,
    name: id,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

function baseAction(
  overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'name'>,
): ConfigAction {
  return {
    categoryId: 'weapons',
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. plain - an ordinary, keyed, multi-command action with no exemption in
//    play at all: it survives purely because its base bind names its alias,
//    same as any pre-story-034 action.
// ---------------------------------------------------------------------------

const plainAction = baseAction({
  id: 'p1a1',
  name: 'SSG SG',
  categoryId: 'weapons',
  key: 'q',
  commands: [{ kind: 'raw', text: 'use shotgun' }, { kind: 'raw', text: 'use sshotgun' }],
})

export const plainProfile: ConfigProfile = baseProfile('fixture-plain', {
  name: 'Plain Profile',
  cvars: { sensitivity: '3', cl_run: '0' },
  binds: { UPARROW: '+forward', q: aliasNameFor(plainAction) },
  actions: [plainAction],
})

// ---------------------------------------------------------------------------
// 2. catalogueMirror - story 034/038's own case: a continuous catalogue row
//    mirrored as its own bare `+command`, unreferenced. Its alias line must
//    be entirely absent from the render (AC1).
// ---------------------------------------------------------------------------

const catalogueMirrorAction = baseAction({
  id: 'c1a1',
  name: 'Forward',
  categoryId: 'movement',
  catalogId: 'movement:forward',
  key: 'w',
  commands: [{ kind: 'raw', text: '+forward' }],
})

export const catalogueMirrorProfile: ConfigProfile = baseProfile('fixture-catalogue-mirror', {
  name: 'Catalogue Mirror Row',
  binds: { w: '+forward' },
  actions: [catalogueMirrorAction],
})

// ---------------------------------------------------------------------------
// 3. aliasEntry - a `kind: 'alias'` entry, unreferenced. AC6: the writer
//    never drops this - that is Care's `aliasUnreferenced` business, not the
//    writer's.
// ---------------------------------------------------------------------------

const aliasEntryAction: ConfigAction = {
  id: 'e1a1',
  categoryId: 'weapons',
  name: '+test',
  kind: 'alias',
  commands: [{ kind: 'raw', text: '+attack' }],
}

export const aliasEntryProfile: ConfigProfile = baseProfile('fixture-alias-entry', {
  name: 'Alias Entry',
  actions: [aliasEntryAction],
})

// ---------------------------------------------------------------------------
// 4. keylessAction - a keyless, unreferenced `kind: 'bind'` action (the User
//    decision): user-authored content the user may be about to bind, kept
//    unlike the catalogue-mirror case above.
// ---------------------------------------------------------------------------

const keylessAction: ConfigAction = {
  id: 'k1a1',
  categoryId: 'weapons',
  name: 'My Combo',
  kind: 'bind',
  commands: [{ kind: 'raw', text: 'wait' }, { kind: 'raw', text: '+attack' }],
}

export const keylessActionProfile: ConfigProfile = baseProfile('fixture-keyless-action', {
  name: 'Keyless Action',
  actions: [keylessAction],
})

// ---------------------------------------------------------------------------
// 5. chunkSplit - a catalogue row whose single raw command is long enough
//    that `alias-render.ts#renderActionAlias` splits it into a `_p<n>`
//    family, and which is otherwise unreferenced exactly like
//    `catalogueMirrorProfile`. The whole family (parent and every chunk) must
//    be absent from the render.
//
//    1000 filler bytes, not story 038 D2's 2000: that command is also
//    written verbatim into `binds.w` below (the real `bindValueFor` mirror
//    for a continuous catalogue row), and `bind w "<command>"` has to stay
//    under `validate-structure.ts`'s own 1024-byte line limit on its own
//    merits - a too-long *bind* line is a real, unrelated finding this
//    fixture must not manufacture. 1000 bytes still overflows
//    `renderActionAlias`'s tighter budget (`alias <name> <command>` adds the
//    alias's own name and the `alias ` keyword on top), so chunking still
//    fires - the corpus just never gets to see it, because the whole family
//    is unreferenced and therefore dropped before it is rendered.
// ---------------------------------------------------------------------------

const CHUNK_SPLIT_COMMAND = `+forward ${'z'.repeat(1000)}`

const chunkSplitAction = baseAction({
  id: 'h1a1',
  name: 'Huge',
  categoryId: 'movement',
  catalogId: 'movement:forward',
  key: 'w',
  commands: [{ kind: 'raw', text: CHUNK_SPLIT_COMMAND }],
})

export const chunkSplitProfile: ConfigProfile = baseProfile('fixture-chunk-split', {
  name: 'Chunk Split Action',
  binds: { w: CHUNK_SPLIT_COMMAND },
  actions: [chunkSplitAction],
})

// ---------------------------------------------------------------------------
// 6. modifierLayer - a catalogue row bound through a modifier slot
//    (`keyModifier`), kept only because a modifier layer's override names its
//    alias (the pre-story-034 modifier-mirror shape) - not because of either
//    documented exemption, so this exercises the reference-collection
//    pathway from `AliasReferenceSources.layers`, not the guard-2 shortcut.
// ---------------------------------------------------------------------------

const modifierAction = baseAction({
  id: 'm1a1',
  name: 'Forward Alt',
  categoryId: 'movement',
  catalogId: 'movement:forward',
  key: 'r',
  keyModifier: 'ALT',
  commands: [{ kind: 'raw', text: '+forward' }],
})

const modifierLayer: AltLayer = {
  id: 'layer-alt-fixture',
  name: 'Alt',
  mode: 'hold',
  triggerKey: 'ALT',
  overrides: { r: aliasNameFor(modifierAction) },
}

export const modifierLayerProfile: ConfigProfile = baseProfile('fixture-modifier-layer', {
  name: 'Modifier Layer Action',
  layers: [modifierLayer],
  actions: [modifierAction],
})

// ---------------------------------------------------------------------------
// 7. holdLayer - a hold layer whose only override chains two other actions'
//    aliases (`alias-render.ts` names, not layer names) into one bind
//    command, forcing `alt-layers.ts#generateLayerAliases` to hoist that
//    chain into its own helper alias (`<base>_c1`). The two actions are kept
//    solely because that *generated* helper body names them - the concrete
//    "kept because referenced from a hold layer's generated body" case story
//    038 D2 tests directly.
// ---------------------------------------------------------------------------

// Named exactly after their own commands on purpose (story 039 review fix): with the readable
// derived name these slug to `forward`/`attack` while their `bindValueFor` mirror stays
// `+forward`/`+attack`, so the file carries `alias forward +forward`. That is the sign-differing
// near-collision shape - legal and reachable in the engine (`forward` is no engine command, so the
// alias really is what a caller reaches), but the shape `validate-structure.ts`'s sign-stripping
// reference heuristic used to mis-read as a self-cycle. Keeping the names here is what holds that
// fix pinned; the "kept because referenced from a hold layer's generated body" behaviour the
// fixture exists for is unaffected either way.
const holdLayerForward = baseAction({
  id: 'ho1a1',
  name: 'Forward',
  categoryId: 'movement',
  catalogId: 'movement:forward',
  commands: [{ kind: 'raw', text: '+forward' }],
})

const holdLayerAttack = baseAction({
  id: 'ho1a2',
  name: 'Attack',
  categoryId: 'weapons',
  catalogId: 'attack:primary',
  commands: [{ kind: 'raw', text: '+attack' }],
})

const holdLayer: AltLayer = {
  id: 'layer-hold-fixture',
  name: 'Drops',
  mode: 'hold',
  triggerKey: 'ALT',
  overrides: { '1': `${aliasNameFor(holdLayerForward)}; ${aliasNameFor(holdLayerAttack)}` },
}

export const holdLayerProfile: ConfigProfile = baseProfile('fixture-hold-layer', {
  name: 'Hold Layer Generated Body',
  layers: [holdLayer],
  actions: [holdLayerForward, holdLayerAttack],
})

// ---------------------------------------------------------------------------
// 8. discreteMirror - a *discrete* (sign-free) catalogue row exactly as
//    `bind-adoption.ts` materialises it from a raw `bind MWHEELUP "weapnext"`:
//    `name` is the row's own command text, so story 039's readable derived
//    name is `weapnext` - textually identical to the command it would run.
//
//    `bindValueFor` has no continuous fast path for a sign-free command and
//    falls through to the alias name, so the mirror value and the alias name
//    are the same string, and the writer would emit the self-referential
//    `alias weapnext weapnext`. That line can never even be reached in-engine
//    (`Cmd_ExecuteString` matches commands before aliases), and
//    `validate-structure.ts` reports it as an error-level `aliasCycle`. This
//    fixture is what pins the writer's self-reference drop guard
//    (`alias-references.ts#actionsWithAliasLine`).
// ---------------------------------------------------------------------------

const discreteMirrorAction = baseAction({
  id: 'd1a1',
  name: 'weapnext',
  categoryId: 'weapons',
  catalogId: 'weaponExtra:weapnext',
  key: 'MWHEELUP',
  commands: [{ kind: 'raw', text: 'weapnext' }],
})

export const discreteMirrorProfile: ConfigProfile = baseProfile('fixture-discrete-mirror', {
  name: 'Discrete Catalogue Mirror Row',
  binds: { MWHEELUP: bindValueFor(discreteMirrorAction) },
  actions: [discreteMirrorAction],
})

// ---------------------------------------------------------------------------
// 9. chunkedSignedBody - an entry long enough that
//    `alias-render.ts#renderActionAlias` splits it into a `_p<n>` chunk family,
//    whose *first chunk* opens with the signed engine command its own root name
//    derives from (`alias forward_p1 "+forward; ..."` under
//    `alias forward "forward_p1; forward_p2"`).
//
//    Story 039's fourth pass, defect 1: `validate-structure.ts`'s carve-out for
//    a legal `alias forward +forward` body used to be scoped to the *visited
//    node's own key*, so it never applied inside a chunk (whose key is
//    `forward_p1`, not `forward`) - the sign-stripped fallback drew
//    `forward_p1 -> forward`, the root's own body drew the way back, and a
//    perfectly legal split action was reported as an error-level `aliasCycle`.
//    Pinned here by the corpus's zero-findings assertion, which the chunked
//    fixture above (5) cannot pin: that one's whole family is dropped as
//    unreferenced before it is ever rendered.
// ---------------------------------------------------------------------------

/** Six commands of ~210 bytes: past `renderActionAlias`'s one-line budget, so the family really
 * splits, while every individual chunk line stays far below the engine's 1024-byte line limit. */
const CHUNKED_SIGNED_COMMANDS = [
  '+forward',
  ...Array.from({ length: 5 }, (_, index) => `say_team going in ${index} ${'a'.repeat(200)}`),
]

const chunkedSignedBodyAction = baseAction({
  id: 'cs1a1',
  name: 'Forward',
  categoryId: 'movement',
  key: 'w',
  commands: CHUNKED_SIGNED_COMMANDS.map((text) => ({ kind: 'raw' as const, text })),
})

export const chunkedSignedBodyProfile: ConfigProfile = baseProfile('fixture-chunked-signed-body', {
  name: 'Chunked Family With A Signed First Command',
  binds: { w: bindValueFor(chunkedSignedBodyAction) },
  actions: [chunkedSignedBodyAction],
})

// ---------------------------------------------------------------------------
// The two self-referencing shapes below are deliberately *not* part of
// `PROFILE_FIXTURES`: since the User's decision (story 039, Decisions (Sprint))
// the writer keeps their alias line as authored, so `validateStructure`
// legitimately reports an error-level `aliasCycle` for them and they cannot sit
// in a corpus asserted to produce zero findings. They are exported as their own
// set instead, and `render-invariants.test.ts` asserts the pair of findings they
// are *supposed* to produce (the structural `aliasCycle` plus
// `validate-actions.ts`'s `aliasSelfReference`, together).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// S1. discreteMirrorCombo - the same shape as 8, one command longer: a free-form
//    entry named after its own first command that carries a *second* command
//    (`weapnext; centerview`). Dropping the line would lose `centerview`
//    entirely, so the writer keeps it and Care reports the self-reference.
// ---------------------------------------------------------------------------

const discreteMirrorComboAction = baseAction({
  id: 'd2a1',
  name: 'weapnext',
  categoryId: 'weapons',
  key: 'MWHEELUP',
  commands: [{ kind: 'raw', text: 'weapnext' }, { kind: 'raw', text: 'centerview' }],
})

export const discreteMirrorComboProfile: ConfigProfile = baseProfile('fixture-discrete-mirror-combo', {
  name: 'Discrete Mirror Row With A Second Command',
  binds: { MWHEELUP: bindValueFor(discreteMirrorComboAction) },
  actions: [discreteMirrorComboAction],
})

// ---------------------------------------------------------------------------
// S2. trailingSelfCall - the same shape reached through a *later* segment
//     instead of the first one: the body's leading segment is an unrelated
//     command and only its second segment (`centerview`) names the entry itself.
//     `buildEdges` finds that edge exactly as it finds a leading one, so the
//     Care finding has to scan every segment, not just the head.
// ---------------------------------------------------------------------------

const trailingSelfCallAction = baseAction({
  id: 'd3a1',
  name: 'centerview',
  categoryId: 'weapons',
  key: 'MOUSE3',
  commands: [{ kind: 'raw', text: '+attack' }, { kind: 'raw', text: 'centerview' }],
})

export const trailingSelfCallProfile: ConfigProfile = baseProfile('fixture-trailing-self-call', {
  name: 'Trailing Self Call',
  binds: { MOUSE3: bindValueFor(trailingSelfCallAction) },
  actions: [trailingSelfCallAction],
})

// ---------------------------------------------------------------------------

/** The clean corpus, keyed by shape name - what `render-invariants.test.ts` iterates and asserts
 * zero `validateStructure` findings for. */
export const PROFILE_FIXTURES: Record<string, ConfigProfile> = {
  plain: plainProfile,
  catalogueMirror: catalogueMirrorProfile,
  aliasEntry: aliasEntryProfile,
  keylessAction: keylessActionProfile,
  chunkSplit: chunkSplitProfile,
  modifierLayer: modifierLayerProfile,
  holdLayer: holdLayerProfile,
  discreteMirror: discreteMirrorProfile,
  chunkedSignedBody: chunkedSignedBodyProfile,
}

/**
 * The shapes whose alias line the writer deliberately keeps even though it calls
 * itself (the User's decision, story 039) - so they are *expected* to produce an
 * error-level `aliasCycle` plus an `aliasSelfReference` Care finding, and belong
 * outside the clean corpus above rather than inside it with an exception list.
 */
export const SELF_REFERENCE_FIXTURES: Record<string, ConfigProfile> = {
  discreteMirrorCombo: discreteMirrorComboProfile,
  trailingSelfCall: trailingSelfCallProfile,
}
