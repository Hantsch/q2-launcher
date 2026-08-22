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
 */

import type { ConfigAction, ConfigProfile } from '../modules/config'
import type { AltLayer } from './alt-layers'
import { aliasNameFor } from './alias-render'

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

/** The whole corpus, keyed by shape name - what `render-invariants.test.ts` iterates. */
export const PROFILE_FIXTURES: Record<string, ConfigProfile> = {
  plain: plainProfile,
  catalogueMirror: catalogueMirrorProfile,
  aliasEntry: aliasEntryProfile,
  keylessAction: keylessActionProfile,
  chunkSplit: chunkSplitProfile,
  modifierLayer: modifierLayerProfile,
  holdLayer: holdLayerProfile,
}
