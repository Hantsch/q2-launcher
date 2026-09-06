import type { AltLayer } from '../config/alt-layers'
import type { AmbiguousRebindAlias } from '../config/alias-import'
// `catalog-rows.ts` imports `ConfigCommand` back from this file, but only as an `import type` -
// erased at compile time, so this is a value import into a type-only cycle, not a runtime one.
import { allCatalogRows, commandsForRow, nameForCatalogRow } from '../config/catalog-rows'
import { ALL_CVARS } from '../config/cvar-catalog'
import { CVAR_GROUP_LABELS, CVAR_GROUP_ORDER, type CvarDef } from '../config/cvar-facts'
import type { ModifierTrigger } from '../config/modifier-layers'
// Type-only both ways: `profile-baseline.ts` needs `ConfigProfile` to describe what it snapshots,
// this file needs its result type. Both imports are erased at compile time, so the cycle exists in
// the type graph only - there is no runtime import between the two modules.
import type { ProfileBaseline } from '../config/profile-baseline'
import type { TidyUpOp } from '../config/tidy-up'

/**
 * The config module's contract.
 *
 * Each module owns one file under `src/shared/modules/` describing the data it
 * exchanges with the UI. Main implements the handlers, the renderer gets a typed
 * client, and neither side imports the other's code - this file is the only
 * thing they share.
 */
export const CONFIG_HANDLERS = {
  list: 'list',
  create: 'create',
  rename: 'rename',
  remove: 'remove',
  assign: 'assign',
  unassign: 'unassign',
  setDefault: 'setDefault',
  setCvars: 'setCvars',
  setBinds: 'setBinds',
  setLayers: 'setLayers',
  setActions: 'setActions',
  write: 'write',
  save: 'save',
  saveRawText: 'saveRawText',
  refreshFromFiles: 'refreshFromFiles',
  preview: 'preview',
  writeState: 'writeState',
  syncState: 'syncState',
  rawFiles: 'rawFiles',
  openFile: 'openFile',
  setPlayedMods: 'setPlayedMods',
  switchBinds: 'switchBinds',
  setSwitchBind: 'setSwitchBind',
  setWriteUnbindall: 'setWriteUnbindall',
  setWriteCatalogDefaults: 'setWriteCatalogDefaults',
  setSectionHeaderStyle: 'setSectionHeaderStyle',
  discard: 'discard',
  importScan: 'import.scan',
  importPreview: 'import.preview',
  importCommit: 'import.commit',
  cleanupScan: 'cleanup.scan',
  cleanupApply: 'cleanup.apply',
  cleanupRestore: 'cleanup.restore',
  tidyUpApply: 'tidyUp.apply',
} as const

/**
 * One installation's link to a profile: the installation is assigned the
 * profile's cvars and binds, and `isDefault` marks whether this is the
 * installation's default profile (at most one assignment per installation
 * should have `isDefault: true` - enforcing that is the job of the module
 * implementing these handlers, not this contract).
 */
export interface ProfileAssignment {
  installationId: string
  isDefault: boolean
}

/**
 * A line of a hand-written config the importer (story 005) did not recognize,
 * kept verbatim rather than dropped. Mirrors `import-reader.ts`'s
 * `ImportedUnrecognizedLine` exactly - the reader's own type stays internal to
 * `main`, this is the shape that travels to the renderer.
 */
export interface UnrecognizedConfigLine {
  /** On-disk file name the line came from, e.g. `config.cfg`. */
  file: string
  /** 1-based line number within that file. */
  line: number
  text: string
}

/**
 * A key name whose `bind` command was silently replaced by a later `bind` of
 * the same key while importing, with no intervening `unbind`/`unbindall` of
 * that key. Mirrors `import-reader.ts`'s `DuplicateBind` exactly - same
 * reasoning as `UnrecognizedConfigLine`. `file`/`line` point at the later
 * `bind`, the one that actually took effect.
 */
export interface DuplicateBindLine {
  key: string
  file: string
  line: number
}

/**
 * An alias name whose `alias` definition was silently replaced by a later
 * `alias` of the same name while importing (story 041) - there is no
 * `unalias` to make a re-definition deliberate the way `unbind` does for
 * binds, so every repeat definition is reported. Mirrors `DuplicateBindLine`
 * exactly, `key` renamed to `name`; same reasoning as `UnrecognizedConfigLine`.
 * `file`/`line` point at the later definition, the one that actually took
 * effect.
 */
export interface DuplicateAliasLine {
  name: string
  file: string
  line: number
}

/**
 * What one entry *is* (story 019): a bind, a named chat message, or an alias definition.
 *
 * Story 008 put this axis on the *category* (`ConfigActionCategory.entryKind`), which made a
 * category "the binds drawer" or "the messages drawer". Story 019 moves it onto the entry, where
 * it belongs: a category is just a drawer the user named, and an alias has to be able to sit next
 * to the binding that references it. The old category field is gone from both category types; a
 * pre-019 `state.json` keeps working because the persisted schema
 * (`main/lib/schemas.ts`) derives each row's `kind` from its category's legacy `entryKind` on read.
 *
 * `'toggle'`/`'press-release'` (story 045 D1) are two-part entries: one alias-worth of commands per
 * state (toggle: state1/state2; press-release: press/release) instead of the single body every
 * other kind has. `commands` stays `[]`, unused, for these two kinds - both halves live in the new
 * `ConfigAction.parts` array instead. See `ActionEntryPart`'s doc comment below for why.
 */
export type ActionEntryKind = 'bind' | 'message' | 'alias' | 'toggle' | 'press-release'

/** A template category — the seed/suggestion source `STANDARD_TEMPLATE` and "New category ->
 * from template" (story 052) draw from, not a special/built-in list any more: story 052 turns
 * categories into ordinary, persisted, profile-owned data, so nothing here is "always shown"
 * regardless of what a profile actually carries. Kept as a shared constant purely because a
 * translatable seed needs one canonical id/label/labelKey triple to draw from.
 *
 * `label` (story 040 D1) is the plain ASCII English text `labelKey` resolves to in the renderer -
 * `comment-labels.ts`'s `categoryLabelFor` uses it directly, since the config-file writer
 * (`render.ts`) runs in main too and can never import i18n. `comment-labels.test.ts` pins it
 * against the matching `en.json` string. */
export interface BuiltInActionCategory {
  id: string
  labelKey: string
  label: string
}

/** Exactly the three the story's AC names, matching upstream's `group: 'main'` set - the template
 * `STANDARD_TEMPLATE.categories` seeds a profile with (story 052 D1), and the suggestion list
 * "New category -> from template" offers alongside a blank one (later deliverable). */
export const TEMPLATE_ACTION_CATEGORIES: readonly BuiltInActionCategory[] = [
  { id: 'movement', labelKey: 'config.controls.categories.movement', label: 'Movement' },
  { id: 'weapons', labelKey: 'config.controls.categories.weapons', label: 'Weapons' },
  { id: 'drops', labelKey: 'config.controls.categories.drops', label: 'Weapon dropping' },
]

/**
 * Story 052 D1: `TEMPLATE_ACTION_CATEGORIES` under its pre-052 name.
 *
 * D4 has since migrated the whole core off it - `render.ts`, `profile-restore.ts`,
 * `alias-import.ts`, `comment-labels.ts` and `tidy-up.ts` no longer treat these three ids as
 * special at all. The renderer's `ControlsTab.tsx` is the one remaining consumer, and rewriting the
 * category rail is D7's job.
 *
 * @deprecated Use `TEMPLATE_ACTION_CATEGORIES` - this name will be dropped once story 052 D7 has
 * updated the last call site (`ControlsTab.tsx`).
 */
export const BUILT_IN_ACTION_CATEGORIES = TEMPLATE_ACTION_CATEGORIES

/**
 * A user-defined category. Its `name` is user-typed text (not translatable UI prose, hence a
 * plain string, unlike `BuiltInActionCategory.labelKey`). Persisted on `ConfigProfile.categories`.
 * Carries no entry kind (story 019): what is typed is the entry (`ConfigAction.kind`), not the
 * drawer it sits in.
 *
 * `nameKey` (story 052 D1) is an optional i18n display hint: `name` is always prose (main must
 * never send a bare key across IPC as if it were text, CLAUDE.md's rule), but when a category was
 * seeded from `TEMPLATE_ACTION_CATEGORIES` and never renamed, the renderer can still show the
 * translated label instead of the frozen English `name`. Set only by a seed (`STANDARD_TEMPLATE`,
 * and later the migration/restore paths D4-D6 touch) as `{ name: <english default>, nameKey }`;
 * any rename drops it (a later deliverable's job - renaming is a plain-string field). Absent for
 * every category that predates this field and for any category a user typed themselves.
 *
 * `subcategories` (story 053 D1) is an optional second level below this category: each entry is
 * `{ id, name }`, the same shape as the category itself minus `nameKey` (a sub-category is always
 * user-typed, never seeded from a translated built-in). Depth is exactly two levels - a
 * sub-category cannot itself have sub-categories. Optional and additive like `nameKey`: a
 * category that predates this field, or one nobody has added a sub-category to, simply omits it
 * (persisted/IPC schemas default a missing value to `[]`, so in-memory code can treat "absent" and
 * "empty" the same way). `ConfigAction.subcategoryId` references one of these by `id`; same "no id
 * is special" rule story 052 D4 gave `categoryId` applies here too - a `subcategoryId` matching
 * nothing in this array is simply an ungrouped entry within the category, not a validation error.
 */
export interface ConfigActionCategory {
  id: string
  name: string
  nameKey?: string
  subcategories?: ConfigActionSubcategory[]
}

/**
 * One sub-category (story 053 D1) - the second and final level below a `ConfigActionCategory`.
 * `name` is user-typed prose, same rule as `ConfigActionCategory.name`; no `nameKey` because a
 * sub-category is never seeded from a translated built-in.
 */
export interface ConfigActionSubcategory {
  id: string
  name: string
}

/**
 * Story 059 D1: a profile-owned grouping of cvars, the Settings-tab counterpart of
 * `ConfigActionCategory` (stories 052/053) - Settings mirrors the profile's own sections instead of
 * the catalogue's fixed `CvarDef.group` (Player/Network/Graphics/Sound). Same field-for-field shape
 * as `ConfigActionCategory`: `name` is prose (user-typed or, for a seeded section, the frozen
 * English default), `nameKey` is the optional i18n display hint set only by a seed
 * (`STANDARD_TEMPLATE`) and dropped by a rename, and `subsections` is the second and final level
 * below it - `{ id, name, cvars }`, no `nameKey`, same "always user-typed, never seeded from a
 * translated built-in" rule `ConfigActionSubcategory` follows.
 *
 * `cvars` lists the cvar names (case as typed/seeded, not cross-validated against the catalogue -
 * an unrecognised name is simply not shown anywhere the catalogue is consulted, not a validation
 * error) this section holds, directly (not inside one of its `subsections`).
 */
export interface ConfigCvarSection {
  id: string
  name: string
  nameKey?: string
  cvars: string[]
  subsections?: ConfigCvarSubsection[]
}

/**
 * One sub-section (story 059 D1) - the second and final level below a `ConfigCvarSection`. `name`
 * is user-typed prose, same rule as `ConfigActionSubcategory.name`; no `nameKey` for the same
 * reason - a sub-section is never seeded from a translated built-in.
 */
export interface ConfigCvarSubsection {
  id: string
  name: string
  cvars: string[]
}

export type ConfigCommand =
  | { kind: 'raw'; text: string }
  | { kind: 'message'; channel: 'say' | 'say_team'; text: string }
  /**
   * Story 045: a `wait <frames>` step - the engine defers the rest of the alias body by `frames`
   * client frames. `frames` is validated against `MAX_WAIT_FRAMES`
   * (`@shared/config/engine-limits`), a launcher sanity cap, not an engine one.
   */
  | { kind: 'wait'; frames: number }

/**
 * One shape for all three entry kinds (bind/message/alias): a message and a multi-command bind
 * are the same thing to the engine (an alias body), so one type serves both instead of two
 * parallel entities needing two renderers/validators. `categoryId` references a
 * `ConfigProfile.categories` entry (story 052 D4: no id is special any more - one that matches
 * nothing the profile carries is an uncategorised entry, written into the file's trailing "Other"
 * bucket).
 * `key`, when set, is the engine key name this action's generated alias is bound to. `bind` and
 * `message` entries may be keyed (a message can sit on a key exactly like a multi-command bind
 * can); a `kind: 'alias'` entry never is — it exists to be referenced by name, not bound, and the
 * UI offers no key slot for it at all (story 019).
 *
 * `keys` (story 015, decisions 1/016; replaced by story 050's arbitrary-slot model) lists every key
 * this action's generated alias is bound to - the engine has no notion of a "primary" and
 * "secondary" bind, so an N-slot row is N `binds` entries (or layer `overrides` entries, for a
 * modified slot) pointing at one alias rather than N duplicate actions. Slot identity comes from
 * the order entries appear in this array, not from a stable id or field name, so the sole access
 * point is `@shared/config/action-slots.ts` (`actionKeySlots`/`keySlotAt`/`withKeySlot`/
 * `clearKeySlot`/`keySlotCount`) - nothing in this codebase reads or writes `keys` directly.
 * Optional and purely additive: an action with no bound key simply omits it, same as an empty array
 * would mean. A pre-050 persisted row instead carries the four fields this array replaced -
 * `key`/`secondaryKey`/`keyModifier`/`secondaryKeyModifier` - and is normalised into up to two
 * `keys` slots on read by both zod mirrors (`main/lib/schemas.ts`, `main/modules/config/schemas.ts`),
 * so no state migration and no data loss for a profile already on a dev machine.
 *
 * `catalogId` (story 015, decision 2) marks an action as the materialised form of a catalogue row
 * (a known movement/weapon/drop entry the editor offers). Identity lives in this field and never
 * in `name`, so a translated or user-edited label cannot make the editor lose track of which row
 * an action belongs to. Absent means "free-form action", which is what every pre-015 action is.
 *
 * `kind` (story 019) is what the entry *is* - a bind, a named message or an alias definition -
 * and it is required: an entry without a kind cannot be rendered or edited. It replaces story
 * 008's per-category `entryKind`, so `setActions` payloads must spell it out (the strict schema
 * rejects a missing or unknown value rather than guessing) while a pre-019 persisted row gets it
 * derived from its category's legacy `entryKind` at parse time.
 *
 * Each `ActionKeySlot.modifier` (story 016) records the modifier - `ALT`/`CTRL`/`SHIFT` - that was
 * held while capturing that slot's key. Quake 2 itself has no notion of a modified bind (see
 * `modifier-layers.ts`'s file doc comment): a captured "Alt+R" is not stored as a literal bind at
 * all. `keys` is the authoritative source the write pipeline consults: `setActions`/`setLayers`
 * (`main/modules/config/profiles.ts`) derive every modifier layer's overrides from it via
 * `applyActionLayerMirror`, skipping the matching key from the base `binds` mirror - a layer
 * override is a generated mirror of these slots, never a second place they could drift from. A
 * plain (unmodified) slot simply omits `modifier`.
 *
 * `aliasName` (story 039, D1) is the human-readable alias name the user typed for this action -
 * `+slow`, not `q2l_a_slow_9a2f`. Optional and additive like `catalogId`: an action without it
 * still renders under the machine-generated `q2l_a_<slug>_<id4>` name
 * (`@shared/config/alias-render.ts#aliasNameFor`) exactly as before this field existed; only once
 * set does the alias render under this name verbatim (sign kept).
 *
 * `keepEmptyAlias` (story 041, D3, "Decided in refine": "Empty-body aliases are entries") marks a
 * `kind: 'alias'` entry whose empty body must still be written as `alias <name> ""` - the case an
 * import produces for a user-authored hook like `alias blaster_settings ""`. Without this field,
 * `alias-render.ts#renderActionAlias`'s "no usable commands -> no alias line" rule (story 038 AC6)
 * would drop it on the first save, which is exactly the silent data loss the story's Decisions rule
 * out. Optional and additive like every other field here: it is only ever set by the importer
 * (`@shared/config/alias-import.ts#buildImportedActions`) on an empty-body `kind: 'alias'` entry, so
 * a generated action alias with no usable commands - the case story 038 AC6 is actually about -
 * simply omits it and keeps producing no line.
 *
 * `parts` (story 045 D1) holds the second half of a two-part entry - `kind: 'toggle'` (state1/
 * state2) or `kind: 'press-release'` (press/release) - as exactly two `ActionEntryPart`s. Optional
 * and additive like every `ConfigAction` field since story 015: a pre-045 persisted row simply omits
 * it, no `STATE_SCHEMA_VERSION` bump, no migration. Absent for every kind but those two; when
 * present it always has exactly two entries, enforced by both zod mirrors
 * (`main/modules/config/schemas.ts`'s strict payload schema rejects any other length,
 * `main/lib/schemas.ts`'s persisted schema drops the row). `commands` on the action itself stays
 * `[]` for `toggle`/`press-release` - it is not where either half lives, so an unaudited reader that
 * only ever looked at `commands` (every reader written before this story) sees an entry with no
 * commands at all rather than silently running half of one.
 */
export interface ConfigAction {
  id: string
  categoryId: string
  /**
   * Story 053 D1: which of `categoryId`'s `subcategories` this entry sits under. Optional and
   * additive like every field since story 015: a pre-053 persisted row simply omits it, which
   * means "directly under the category, ungrouped" - the same reading given to a value that
   * doesn't match any of the category's `subcategories` (mirrors `categoryId` itself: no id is
   * special, an unrecognised one just falls into the ungrouped bucket rather than erroring).
   */
  subcategoryId?: string
  name: string
  kind: ActionEntryKind
  commands: ConfigCommand[]
  keys?: readonly ActionKeySlot[]
  catalogId?: string
  aliasName?: string
  keepEmptyAlias?: true
  parts?: ActionEntryPart[]
}

/**
 * Story 045 D1: one state's worth of commands for a two-part `ConfigAction` (`kind: 'toggle'` or
 * `kind: 'press-release'`) - `commands` is that state's alias body, `label` an optional
 * user-facing name for the state/phase (e.g. "on"/"off", "press"/"release"), and `aliasName` the
 * same per-part "user typed this name verbatim" affordance `ConfigAction.aliasName` gives the
 * single-body kinds. `ConfigAction.parts`, when present, always holds exactly two of these - see
 * its own doc comment for why the first half never lives in `ConfigAction.commands`.
 */
export interface ActionEntryPart {
  commands: ConfigCommand[]
  label?: string
  aliasName?: string
}

/**
 * One key slot on a `ConfigAction` - the engine key this action's generated alias is bound to
 * (`key`), plus the modifier (`modifier`) that was held while capturing it, if any. See
 * `ConfigAction.keys`'s doc comment above for what an array of these represents and why nothing
 * outside `@shared/config/action-slots.ts` reads or writes it directly.
 */
export interface ActionKeySlot {
  key: string
  modifier?: ModifierTrigger
}

/**
 * A config profile: a named set of cvars and key binds, owned centrally rather
 * than by one installation, and identified by a generated `id` so renaming it
 * never breaks a reference (same rule as `Installation`).
 *
 * `cvars` and `binds` are the content maps - keyed by cvar name and by key name
 * respectively. They exist from the start but stay empty for now; filling them
 * is the job of later stories, which then do not have to reshape the persisted
 * record.
 *
 * `assignments` lists the installations this profile is linked to.
 *
 * `unrecognized` (story 005) lists lines an import could not classify, kept so
 * AC 4 ("shown to me, not silently dropped") survives past the import dialog.
 * Optional rather than a required `[]` on every profile: it is only ever
 * populated by an import, so most profiles (empty/template/copy-created, and
 * every profile that predates story 005) simply omit it instead of every
 * construction site in the codebase having to spell out an empty array.
 *
 * `layers` (story 006) lists the profile's alternate binding layers (hold or
 * toggle), each with its own `overrides` map layered on top of `binds`. Same
 * precedent as `unrecognized`: optional and defaulted by a forgiving
 * `.catch(() => [])` in the persisted schema, so no `STATE_SCHEMA_VERSION`
 * bump and no reshaping of existing persisted profiles.
 *
 * `categories`/`actions` (story 008) list the profile's user-defined action
 * categories and its binds/messages/aliases, respectively. Same precedent
 * again: optional, so a pre-story-008 profile simply omits them, and a
 * forgiving row-level-drop in the persisted schema (not the whole-array
 * `.catch()` `layers` uses) so one malformed row does not wipe the rest.
 *
 * `writeUnbindall` (story 040 D4) is whether the rendered `.cfg` opens with a bare `unbindall`
 * line, directly after the header block (`@shared/config/render.ts#renderProfileFile`). Optional
 * and defaults to **on** - a profile with no stored value (every profile predating this story)
 * behaves exactly as `true`, via `.catch(true)` in the persisted schema
 * (`main/lib/schemas.ts`) and the same `!== false` read at render time, so there is no migration
 * step and no reshaping of existing profiles.
 *
 * `sectionHeaderStyle` (story 042 D7) is the decoration a rendered `.cfg`'s section banners use -
 * `'dashes'` (`// --- Weapons ---...`, today's only format and the implicit default), `'brackets'`
 * (`// ----- [ Weapons ] -----`) or `'plain'` (`// Weapons`, no decoration at all). Same
 * `writeUnbindall` precedent exactly: optional, `.catch('dashes')` in the persisted schema, no
 * migration entry, and a profile with no stored value renders byte-identical to what this file
 * emitted before this setting existed.
 *
 * `fileHash`/`fileSeenAt`/`dirty`/`fileState` (story 043 D2) are the cache the file-read layer
 * (`main/modules/config/file-source.ts#readFileState`) needs to tell "nothing changed since we last
 * looked" apart from "the file changed on disk since then" without re-parsing on every check.
 * `fileHash` is a sha-256 of the canonical file's own latin1 bytes - the launcher's own write seeds
 * it with the hash of exactly what it just wrote (`file-source.ts#hashCanonicalFileContent`), which
 * is what keeps that write from ever being mistaken for an external edit on the very next read.
 * `fileSeenAt` is when that hash was last confirmed (epoch ms). `dirty` and `fileState` are read-only
 * caches of the last classification `readFileState` returned; nothing here is written by this
 * deliverable's file-read layer itself, only read back by it and by whatever later deliverable saves
 * the classification. Same convention as `writeUnbindall`/`sectionHeaderStyle`: optional,
 * `.catch()`-defaulted in the persisted schema (`main/lib/schemas.ts`), no migration entry - a
 * profile predating this story simply has none of the four fields.
 *
 * `baseline` (story 049 D1) is the render-relevant subset of this profile as it stood the last time
 * the launcher and its `.cfg` agreed - `captureBaseline` (`@shared/config/profile-baseline`), whose
 * own doc comment covers what is in the subset and why it is a subset of the record rather than the
 * file's text. It is what "unsaved change" is measured against, and what a discard restores.
 *
 * It is (re)seeded at exactly the points `fileHash` is, and by the same calls - `markFileSeen`,
 * `adoptFromFile` and `addRebuilt` (`main/modules/config/profiles.ts`), plus the one-time format
 * migration (`main/modules/config/rebuild.ts`). Tying the two together is deliberate (story 049,
 * Decisions): "the file now holds exactly this" and "this is what unsaved is measured against" are
 * the same fact, so an external edit adopted by 043's refresh, or a conflict resolved through its
 * dialog, cannot leave a stale snapshot behind for one of them and not the other.
 *
 * Optional, same convention as everything above it: a profile whose canonical file has never been
 * written - and every profile persisted before this story - simply has no `baseline`, which reads as
 * "no known saved state" (the bar then reports that and disables discard rather than guessing a
 * baseline by re-parsing the file).
 *
 * `cvarSections` (story 059 D1) is the Settings-tab counterpart of `categories`/`actions` above -
 * the profile's own cvar sections/sub-sections (`ConfigCvarSection`), which the Settings tab groups
 * by instead of the catalogue's fixed `CvarDef.group`. Same precedent exactly: optional, so a
 * profile predating this story simply omits it, and forgiving row-level-drop in the persisted
 * schema (not a whole-array `.catch()`) so one malformed section does not wipe the rest. Only
 * `from: 'template'` seeds it (`STANDARD_TEMPLATE.cvarSections`); `from: 'empty'` and every other
 * creation path carry none.
 *
 * `writeCatalogDefaults` (story 059 D1) is a model/schema-only field this deliverable adds -
 * whether the writer (a later deliverable) should still emit a `set` line for every catalogue cvar
 * a profile's own sections do not mention, the way it does unconditionally today (story 048 D2).
 * Optional and forgiving like `writeUnbindall`: a profile with no stored value, including every
 * profile persisted before this story, behaves exactly as `true` - today's own behaviour - via
 * `.catch(true)` in the persisted schema (`main/lib/schemas.ts`), so there is no migration step and
 * no reshaping of existing profiles.
 */
export interface ConfigProfile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  cvars: Record<string, string>
  binds: Record<string, string>
  assignments: ProfileAssignment[]
  unrecognized?: UnrecognizedConfigLine[]
  layers?: AltLayer[]
  categories?: ConfigActionCategory[]
  actions?: ConfigAction[]
  cvarSections?: ConfigCvarSection[]
  writeUnbindall?: boolean
  writeCatalogDefaults?: boolean
  sectionHeaderStyle?: 'dashes' | 'brackets' | 'plain'
  fileHash?: string
  fileSeenAt?: number
  dirty?: boolean
  fileState?: ProfileFileState
  baseline?: ProfileBaseline
}

/**
 * Story 043 D2: which of the five outcomes `readFileState`
 * (`main/modules/config/file-source.ts`) classified the profile's canonical file into, relative to
 * its previously cached `fileHash` - `unchanged`/`changedOnDisk` when the file was read
 * successfully, `missing` for `ENOENT` specifically, `unparseable` when the file read but produced
 * no valid profile at all, `readError` for any other read failure (permissions, an I/O fault). See
 * `readFileState`'s own doc comment for the exact rule that tells `changedOnDisk` apart from
 * `unparseable` - a hand-deleted metadata comment degrades to the former, never the latter.
 */
export type ProfileFileState = 'unchanged' | 'changedOnDisk' | 'missing' | 'unparseable' | 'readError'

/** Where a new profile's content comes from. */
export type ConfigProfileSeed = 'empty' | 'template'

/**
 * The read-only seed a profile can be created from. Read-only on purpose: a
 * profile's own maps/arrays are mutable, so a caller has to copy this rather
 * than hand the shared module-level object to a profile that is about to be
 * edited.
 *
 * `categories`/`actions` (story 052 D1) are the template's own seed of
 * `TEMPLATE_ACTION_CATEGORIES` plus one action per `catalog-rows.ts` row - see
 * `STANDARD_TEMPLATE`'s own doc comment for what each contains.
 */
export interface ConfigProfileTemplate {
  readonly cvars: Readonly<Record<string, string>>
  readonly binds: Readonly<Record<string, string>>
  readonly categories: readonly ConfigActionCategory[]
  readonly actions: readonly ConfigAction[]
  readonly cvarSections: readonly ConfigCvarSection[]
}

/**
 * A deliberately minimal seed of vanilla Quake II defaults, so that "create
 * from template" is visibly different from "create empty". The full,
 * source-cited cvar catalogue belongs to the settings/cvar editor story - this
 * is not it, and it is not meant to be exhaustive.
 *
 * `categories` (story 052 D1) is `TEMPLATE_ACTION_CATEGORIES` materialised into ordinary,
 * persisted `ConfigActionCategory` rows: `{ id, name: <english default>, nameKey }` each - `name`
 * is the frozen English default so a profile that never renames the category still has real prose
 * to show even before `nameKey` resolves to anything (CLAUDE.md's "main never sends bare prose
 * disguised as a key" rule cuts the other way too: an i18n key alone is not a valid `name`).
 *
 * `actions` is one `ConfigAction` per `allCatalogRows()` row (`@shared/config/catalog-rows`) -
 * "every catalogue row becomes an action, unbound" (story 052 AC4) - except the six rows this
 * template's own `binds` above already names (the five continuous movement commands plus
 * `+attack`), which keep that row's own command as their `commands` so the profile's first
 * `commit()` (`ProfilesStore`, which runs `adoptRawBinds` on every write) recognises the matching
 * `binds` entry as *this* row rather than minting a second, duplicate action for it. Every other
 * row's `commands` is `[]`: present in the profile, nothing to render into the file yet (story
 * 052 D2/D3's "unbound line" is what gives a row like that a trace in the `.cfg` at all - out of
 * scope for this deliverable). Ids are stable per catalogue row (`template:<catalogId>`) since
 * this object is itself immutable and shared across every "create from template" call -
 * `profiles.ts#create` mints fresh ids when it copies this array into a new profile, exactly as it
 * already does for every other generated id.
 */
/**
 * Story 052 D1: catalogue rows this template's own `binds` above already names - the five
 * continuous movement commands plus `+attack` (also a `MOVEMENT_ACTIONS` row upstream, despite the
 * name), all of them `movement:*` catalogIds. `buildTemplateActions` below is what keeps this list
 * and `STANDARD_TEMPLATE.binds` from drifting apart - both are read off the same six keys.
 *
 * Exported (story 052 review, F1) so `migrations.ts`'s D6 step can give a newly-materialised action
 * for one of these six catalogIds the same real `commandsForRow(row, false)` command
 * `buildTemplateActions` writes, instead of `commands: []` - a migrated action for a row the profile
 * has *always* had a matching raw bind for must look identical to what a fresh `from: 'template'`
 * profile gets, or `adoptRawBinds`' signature match (`@shared/config/bind-adoption.ts`) cannot
 * recognise the raw bind as this row and the Controls tab shows it as unbound despite the key
 * working in-game.
 */
export const TEMPLATE_BOUND_CATALOG_IDS = new Set(['forward', 'back', 'moveup', 'movedown', 'speed', 'attack'].map(
  (id) => `movement:${id}`,
))

/**
 * One `ConfigAction` per `allCatalogRows()` row - see `STANDARD_TEMPLATE`'s own doc comment for
 * why every row but the template's six binds is unbound (`commands: []`).
 */
/**
 * Story 053 D5: the five sub-categories the standard template seeds, replacing the old
 * catalogue-id-prefix grouping (`controls-row-groups.ts`'s deleted `GROUP_LABEL_KEY_BY_PREFIX`,
 * which mapped `weaponUse`/`weaponExtra`/`dropWeapon`/`dropAmmo`/`dropMisc` `CatalogRowKind`
 * prefixes to these same five headers). Literal English `name`s, no `nameKey` - "a profile's
 * structure is user data, not i18n keys" (story decision), unlike `TEMPLATE_ACTION_CATEGORIES`'s
 * own translated `label`/`labelKey` pair.
 */
const WEAPONS_USE_SUBCATEGORY_ID = 'weapons-use'
const WEAPONS_CYCLING_SUBCATEGORY_ID = 'weapons-cycling'
const DROPS_WEAPONS_SUBCATEGORY_ID = 'drops-weapons'
const DROPS_AMMO_SUBCATEGORY_ID = 'drops-ammo'
const DROPS_MISC_SUBCATEGORY_ID = 'drops-misc'

/** `CatalogRowKind` prefix (`row.catalogId.split(':')[0]`) -> the template sub-category it seeds
 * into, mirroring exactly what the deleted `GROUP_LABEL_KEY_BY_PREFIX` used to map visually. A
 * prefix missing here (`movement`) gets no `subcategoryId` - it lands in the ungrouped run, same
 * as before. */
const TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX: Record<string, string> = {
  weaponUse: WEAPONS_USE_SUBCATEGORY_ID,
  weaponExtra: WEAPONS_CYCLING_SUBCATEGORY_ID,
  dropWeapon: DROPS_WEAPONS_SUBCATEGORY_ID,
  dropAmmo: DROPS_AMMO_SUBCATEGORY_ID,
  dropMisc: DROPS_MISC_SUBCATEGORY_ID,
}

function templateSubcategoryIdFor(catalogId: string): string | undefined {
  const prefix = catalogId.split(':')[0] ?? ''
  return TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX[prefix]
}

/**
 * One `ConfigAction` per `allCatalogRows()` row - see `STANDARD_TEMPLATE`'s own doc comment for
 * why every row but the template's six binds is unbound (`commands: []`).
 */
function buildTemplateActions(): ConfigAction[] {
  return allCatalogRows().map((row) => {
    const bound = TEMPLATE_BOUND_CATALOG_IDS.has(row.catalogId)
    const subcategoryId = templateSubcategoryIdFor(row.catalogId)
    return {
      id: `template:${row.catalogId}`,
      categoryId: row.categoryId,
      name: nameForCatalogRow(row),
      kind: 'bind',
      catalogId: row.catalogId,
      commands: bound ? commandsForRow(row, false) : [],
      ...(subcategoryId ? { subcategoryId } : {}),
    }
  })
}

/**
 * Story 059 D1: `CVAR_GROUP_ORDER`'s four groups, materialised into ordinary, persisted
 * `ConfigCvarSection` rows - `{ id: <group>, name: <english default>, nameKey, cvars }` each,
 * mirroring exactly how `STANDARD_TEMPLATE.categories` materialises `TEMPLATE_ACTION_CATEGORIES`.
 * `id` is the group name itself (`'player'`/`'network'`/`'graphics'`/`'sound'`) - stable and unique
 * on its own, so no extra id scheme is needed. `name` is `CVAR_GROUP_LABELS`' plain-ASCII English
 * default; `nameKey` is the same `config.settings.groups.<group>` key the Settings tab already
 * resolves through i18n (`SettingsTab.tsx`'s own `GROUP_LABEL_KEY`) - not re-exported as a shared
 * constant there today, so this is the key string spelled out directly, same value either way.
 * `cvars` is every `ALL_CVARS` entry whose `group` matches (further narrowed by the optional
 * `include` predicate, when given), in catalogue order. No `subsections` - the catalogue itself
 * carries no third level.
 *
 * Exported (story 059 D6) so the one-time migration for pre-059 profiles
 * (`main/services/migrations.ts`) can reuse the exact same grouping instead of re-deriving it -
 * `include` is what lets the migration narrow each group down to only the cvar names a given
 * profile's own `cvars` actually has, rather than seeding every `ALL_CVARS` name the way a fresh
 * `STANDARD_TEMPLATE` profile does (the call below, with no `include`, is unaffected).
 */
export function buildTemplateCvarSections(include?: (name: string) => boolean): ConfigCvarSection[] {
  return CVAR_GROUP_ORDER.map((group) => ({
    id: group,
    name: CVAR_GROUP_LABELS[group],
    nameKey: `config.settings.groups.${group}`,
    cvars: ALL_CVARS.filter((def: CvarDef) => def.group === group && (!include || include(def.name))).map(
      (def: CvarDef) => def.name,
    ),
  }))
}

export const STANDARD_TEMPLATE: ConfigProfileTemplate = {
  cvars: {
    sensitivity: '3',
    cl_run: '0',
    crosshair: '0',
    cl_gun: '1',
    m_pitch: '0.022',
    volume: '0.7',
  },
  binds: {
    UPARROW: '+forward',
    DOWNARROW: '+back',
    SPACE: '+moveup',
    c: '+movedown',
    SHIFT: '+speed',
    MOUSE1: '+attack',
  },
  categories: TEMPLATE_ACTION_CATEGORIES.map((category) => ({
    id: category.id,
    name: category.label,
    nameKey: category.labelKey,
    ...(category.id === 'weapons'
      ? {
          subcategories: [
            { id: WEAPONS_USE_SUBCATEGORY_ID, name: 'Use weapon' },
            { id: WEAPONS_CYCLING_SUBCATEGORY_ID, name: 'Cycling' },
          ],
        }
      : {}),
    ...(category.id === 'drops'
      ? {
          subcategories: [
            { id: DROPS_WEAPONS_SUBCATEGORY_ID, name: 'Weapons' },
            { id: DROPS_AMMO_SUBCATEGORY_ID, name: 'Ammunition' },
            { id: DROPS_MISC_SUBCATEGORY_ID, name: 'Misc' },
          ],
        }
      : {}),
  })),
  actions: buildTemplateActions(),
  cvarSections: buildTemplateCvarSections(),
}

export interface CreateConfigProfileInput {
  name: string
  from: ConfigProfileSeed
}

export interface RenameConfigProfileInput {
  id: string
  name: string
}

export interface RemoveConfigProfileInput {
  id: string
}

export interface AssignProfileInput {
  profileId: string
  installationId: string
}

export interface UnassignProfileInput {
  profileId: string
  installationId: string
}

export interface SetDefaultProfileInput {
  profileId: string
  installationId: string
}

/**
 * `cvarSections` (story 059 D1) is optional and additive: a caller not yet updated to send the
 * profile's own cvar sections (every renderer call site before a later deliverable wires this up)
 * simply omits it, which leaves the profile's stored `cvarSections` untouched - same "send nothing,
 * change nothing" convention `SetProfileActionsInput`'s whole-field replace fields do not have (those
 * are required), because this one field is meant to travel independently of the `cvars` map replace
 * this input already performs.
 */
export interface SetProfileCvarsInput {
  profileId: string
  cvars: Record<string, string>
  cvarSections?: ConfigCvarSection[]
}

export interface SetProfileBindsInput {
  profileId: string
  binds: Record<string, string>
}

export interface SetProfileLayersInput {
  profileId: string
  layers: AltLayer[]
}

export interface SetProfileActionsInput {
  profileId: string
  categories: ConfigActionCategory[]
  actions: ConfigAction[]
}

/** Per-installation outcome of a `write` call. */
export type WriteTargetStatus = 'written' | 'unchanged' | 'pending' | 'error'

export interface WriteTargetResult {
  installationId: string
  status: WriteTargetStatus
  /** Set when status is 'error' or to explain 'pending'. i18n key. */
  messageKey?: string
}

export interface WriteProfileInput {
  profileId: string
}

/**
 * Story 043 D4: `save` - the one operation that writes a profile's content to disk now.
 *
 * The deliberate inversion of story 022 decision 8 ("every mutation writes immediately"): the
 * mutating handlers (`setCvars`, `setBinds`, `setLayers`, `setActions`, `rename`,
 * `setWriteUnbindall`, `setSectionHeaderStyle`) still persist into `state.json` at once - a crash
 * must not lose an edit - but they no longer touch a file; they mark the profile as carrying unsaved
 * edits. This channel is what turns those edits into the canonical `.cfg`, and only after checking
 * that the file still looks the way the launcher last saw it.
 *
 * Nothing but the profile id: what to write is the cached profile, and *where* is resolved in main
 * from the profile list (a payload can never aim a write at a path of its choosing).
 *
 * `force` (story 043 D8) is the "overwrite with my version" resolution of `ConfigConflictDialog`:
 * when true, the handler skips the re-read/conflict check entirely and writes the cached profile's
 * render unconditionally, exactly as it would for `unchanged`/`missing`. It exists only to be set
 * right after the user has explicitly been shown a `SaveProfileConflict` (both whole-file versions)
 * and chosen to keep theirs - never set by the ordinary `ProfileSaveBar` save path, which always
 * omits it (equivalent to `false`).
 */
export interface SaveProfileInput {
  profileId: string
  force?: boolean
}

/** The canonical file was written and the installation copies re-synced from it. */
export interface SaveProfileSaved {
  status: 'saved'
  /** The profile as it now stands: no longer dirty, `fileHash` reseeded from what was written. */
  profile: ConfigProfile
  /** Where every copy of the profile stands afterwards, from the same sync run that wrote them. */
  sync: ProfileSyncState
}

/**
 * The file changed underneath the launcher since it last read or wrote it, so nothing was written
 * (story AC5: "the launcher never overwrites a hand-edit it has not read"). Whole-file granularity
 * is the decided conflict shape, hence both whole texts rather than a diff: the UI (a later
 * deliverable) shows them side by side and the user resolves it.
 */
export interface SaveProfileConflict {
  status: 'conflict'
  /** Name the profile's canonical file actually carries on disk right now. */
  fileName: string
  path: string
  /** The file's current content, latin1 text, exactly the bytes the conflict was detected from. */
  diskContent: string
  /** What the save would have written - the cached profile, rendered. */
  ourContent: string
}

/**
 * The file exists but could not be used as a baseline - it failed to read at all (`readError`) or
 * produced no valid profile (`unparseable`). Never a write: an unreadable file is treated exactly
 * like a changed one, since it is equally something the launcher has not read.
 */
export interface SaveProfileUnreadable {
  status: 'unreadable'
  fileName: string
  path: string
  reason: 'unparseable' | 'readError'
  /** 1-based line for `unparseable`; absent for `readError`, which has no position. */
  line?: number
  message: string
}

export type SaveProfileResult = SaveProfileSaved | SaveProfileConflict | SaveProfileUnreadable

/**
 * Story 057 D4: `saveRawText` - the Raw file tab's inline editor saving the text the user typed
 * straight onto the profile's canonical `.cfg`, byte for byte.
 *
 * The deliberate difference from `save` above: `save` writes what the *cached profile renders to*,
 * this writes what the *user typed*, and the profile is then brought in line with the file by
 * reading it back (the same adopt path `refreshFromFiles` uses for an external edit) - never the
 * other way round. Nothing re-renders the profile over these bytes at any point in the call, which
 * is what makes AC "the file on disk is exactly what I typed" true.
 *
 * `text` is the whole file, not a patch: the editor holds the whole file and a patch protocol would
 * need a base revision this channel deliberately does not have (the conflict guard below is that
 * base revision, at whole-file granularity, exactly like `save`'s).
 *
 * `force` is the same "overwrite with my version" resolution `SaveProfileInput.force` is, and means
 * the same thing here: skip the re-read/conflict check and write `text` unconditionally, only ever
 * set right after the user was shown a `SaveProfileConflict` and chose to keep their own version.
 *
 * There is no path field, and never will be: which file this lands in is resolved in main from the
 * profile's own ownership stamp, exactly as `save` resolves it.
 */
export interface SaveRawTextInput {
  profileId: string
  /** The complete file content to write, latin-1 text. */
  text: string
  force?: boolean
}

/**
 * The typed text is on disk and the profile has been brought in line with it.
 *
 * `droppedAliases`/`preservedLines` are what the read-back could NOT keep in the structured profile,
 * and the whole reason this result is richer than `save`'s: the file may now say things the launcher
 * does not model, and AC6 ("text the launcher cannot read back cleanly is never silently mangled")
 * requires saying so rather than letting the difference surface later as a silent loss.
 */
export interface SaveRawTextSaved {
  status: 'saved'
  /** Name the profile's canonical file actually carries on disk - the file this write landed in. */
  fileName: string
  path: string
  /** The profile as adopted from the freshly written file, `fileHash` reseeded from those bytes. */
  profile: ConfigProfile
  /**
   * Alias names the written text defines more than once, so the adopted profile is missing whatever
   * the earlier definition of each said - the same field, from the same fold, as
   * `RefreshedProfileResult`'s `adopted` branch carries. `[]` is the normal case.
   */
  droppedAliases: string[]
  /**
   * Lines of the written file the launcher kept verbatim but does not model as a cvar/bind/alias -
   * they live in the file (which is the source of truth) but not in the structured profile, so the
   * next *structured* save would render them away.
   *
   * Comment-only lines are deliberately NOT in here, unlike the import preview's own `preserved`
   * list: every launcher-written file is full of banner comments the writer regenerates from the
   * profile anyway, and counting those would drown the one thing this field exists to report.
   */
  preservedLines: UnrecognizedConfigLine[]
}

/**
 * Reuses `save`'s own `conflict`/`unreadable` shapes rather than declaring look-alikes, so the
 * renderer handles one conflict concept and one unreadable concept for both save paths (the same
 * reasoning `RefreshedProfileResult`'s `conflict` branch already applies). One nuance:
 * `SaveProfileConflict.ourContent` is documented as "what the save would have written" - for this
 * channel that is the typed text itself, not a render of the cached profile.
 */
export type SaveRawTextResult = SaveRawTextSaved | SaveProfileConflict | SaveProfileUnreadable

/**
 * Story 043 D5: `refreshFromFiles` - the re-read side of the story's "re-read on window focus, tab
 * open, and before write" decision. `profileId` scopes the check to one profile (window focus/tab
 * open, per "Decided during refine": reading every profile's file on every focus event would make
 * focus latency scale with the profile count); omitted, every profile is checked (used at startup).
 *
 * `discardLocalEdits` (story 043 D8) is the "take the file" resolution of `ConfigConflictDialog`:
 * when true and `profileId` names a profile that is both dirty and `changedOnDisk`, the handler
 * adopts the disk version instead of returning a conflict - the same `adopted` branch a non-dirty
 * profile already takes, just no longer refused for carrying unsaved edits the user has just
 * explicitly agreed to throw away. Only meaningful together with a `profileId`; the whole-list
 * startup call never sets it.
 */
export interface RefreshFromFilesInput {
  profileId?: string
  discardLocalEdits?: boolean
}

/**
 * One profile's outcome from a `refreshFromFiles` call, discriminated on `outcome` rather than on
 * `fileState` alone: `readFileState`'s own `changedOnDisk` classification (`ProfileFileState`,
 * story D2) covers two different results here depending on whether the profile carried unsaved
 * edits at the time - adopted (no conflict) or a conflict - so `fileState` alone cannot tell the two
 * apart. `fileState` is still carried on every branch (mirroring `ProfileFileState`'s own values) so
 * a caller that only wants "does this profile's file still look like what we last saw" never has to
 * switch on `outcome` first.
 */
export type RefreshedProfileResult =
  | { profileId: string; outcome: 'unchanged'; fileState: 'unchanged' }
  | {
      profileId: string
      outcome: 'adopted'
      fileState: 'changedOnDisk'
      profile: ConfigProfile
      /**
       * Alias names the file defined more than once, so the adopted profile is missing whatever the
       * earlier definition of each said (story-050 review, finding 4, second round). File data - the
       * names as the file spells them - never prose, and never empty-vs-absent: `[]` is the normal
       * case and means the adopt lost nothing.
       *
       * On the wire because the loss is invisible everywhere else: main's own `alias` fold discards
       * the earlier body before the profile is reconstructed
       * (`main/modules/config/file-source.ts#foldConfig`), and the adopted profile that arrives here
       * looks exactly like one written from a file that only ever had one such entry - Care's
       * `aliasDuplicate` rule cannot fire on it either, because the colliding entry it would name is
       * the one that just disappeared. Without this field an adopt silently drops a user's entry,
       * which is precisely what AC3's "never a silent swap" forbids.
       */
      droppedAliases: string[]
    }
  | {
      profileId: string
      outcome: 'conflict'
      fileState: 'changedOnDisk'
      /**
       * Same whole-file conflict shape `save` (story D4) already returns for its own
       * `changedOnDisk` case - reused rather than duplicated, so the renderer (a later
       * deliverable) never has to handle two different shapes for the same concept.
       */
      conflict: SaveProfileConflict
    }
  | {
      profileId: string
      outcome: 'unparseable'
      fileState: 'unparseable'
      file: string
      line: number
      message: string
    }
  | { profileId: string; outcome: 'missing'; fileState: 'missing' }
  | { profileId: string; outcome: 'readError'; fileState: 'readError'; message: string }

export type RefreshFromFilesResult = RefreshedProfileResult[]

export interface PreviewProfileInput {
  profileId: string
  installationId: string
}

/** One rendered file the write pipeline would put (or did put) on disk. */
export interface PreviewFile {
  /** Absolute path on the target installation. */
  path: string
  content: string
  /**
   * Whether `path` already exists as a file on disk, checked by the `preview`
   * handler in main at preview time - never by this pure, shared type or by
   * the renderer itself.
   */
  onDisk: boolean
}

export interface PreviewProfileResult {
  files: PreviewFile[]
}

export interface SetPlayedModsInput {
  installationId: string
  playedMods: string[]
}

/**
 * Story 007: which key (if any) cycles an installation's assigned profiles
 * in-session. Per installation, not per profile (decision 1) - it is not part
 * of `ConfigProfile` since one profile can be assigned to many installations.
 */
export interface SetSwitchBindInput {
  installationId: string
  /** null clears the bind for that installation. */
  key: string | null
}

/**
 * Story 040 D4: sets one profile's `writeUnbindall` flag - a dedicated handler rather than routed
 * through `setCvars`/`setBinds`/`setLayers`/`setActions` (those are whole-field replace setters
 * for a different field each, and this is a single boolean of its own), mirroring the shape of
 * `SetPlayedModsInput`/`SetSwitchBindInput` above.
 */
export interface SetWriteUnbindallInput {
  profileId: string
  writeUnbindall: boolean
}

/**
 * Story 059 D9: sets one profile's `writeCatalogDefaults` flag - a dedicated handler mirroring
 * `SetWriteUnbindallInput`/`setWriteUnbindall` exactly, just a different boolean field (whether
 * unplaced catalogue cvars still get written into the reserved `Defaults` section, D1/D2).
 */
export interface SetWriteCatalogDefaultsInput {
  profileId: string
  writeCatalogDefaults: boolean
}

/**
 * Story 042 D7: sets one profile's `sectionHeaderStyle` - a dedicated handler mirroring
 * `SetWriteUnbindallInput`/`setWriteUnbindall` exactly, just a 3-way enum in place of a boolean.
 */
export interface SetSectionHeaderStyleInput {
  profileId: string
  sectionHeaderStyle: 'dashes' | 'brackets' | 'plain'
}

/**
 * Story 049 D3: `discard`'s input - a profile id, nothing else. What is restored is always
 * `profile.baseline` (`@shared/config/profile-baseline`), never something the caller chooses, so
 * there is nothing more to carry: discard is "go back to what I last saved", never a partial or
 * targeted undo (the story's own Decisions: "Discard exists on the profile-wide bar only
 * (all-or-nothing)").
 */
export interface DiscardProfileInput {
  profileId: string
}

/**
 * Story 049 D3: `discard` restored the profile's render-relevant fields to its `baseline` and
 * returns the full, updated profile list - same "returns the list every mutation returns" shape as
 * `rename`/`setCvars`/etc., just discriminated on `status` because there is a second, non-mutating
 * outcome below.
 */
export interface DiscardProfileDiscarded {
  status: 'discarded'
  profiles: ConfigProfile[]
}

/**
 * Story 049 D3: the profile named by `discard`'s input has no `baseline` - never saved, or a
 * pre-story `state.json` record with `dirty === true` and nothing to fall back to (the Decisions'
 * "honest for one upgrade cycle instead of guessing a baseline by re-parsing the file"). Nothing was
 * mutated; the renderer is expected to show why discard is unavailable rather than treat this as a
 * silent no-op success.
 */
export interface DiscardProfileNoBaseline {
  status: 'noBaseline'
}

export type DiscardProfileResult = DiscardProfileDiscarded | DiscardProfileNoBaseline

/**
 * Which installation is currently waiting for a retry, and for which profile -
 * i.e. the last `write` attempt found it running and skipped it. Keyed by
 * installationId; an installation absent from this map has nothing pending.
 */
export type WriteState = Record<string, string>

/** Per-file sync status the write pipeline can report (story 022, D5 - data contract only). */
export type ProfileFileSyncStatus = 'inSync' | 'outOfSync' | 'missing' | 'pending' | 'error'

/** One file's sync status: the canonical copy, or one installation's copy. */
export interface ProfileFileSync {
  /** Absolute path of the file this status describes. */
  path: string
  /** File name only (matches `resolveProfileFileNames`' output for this profile). */
  fileName: string
  status: ProfileFileSyncStatus
  /** Set when status is 'error', or to explain 'pending'. i18n key, never prose. */
  messageKey?: string
}

/** One assigned installation's copy, same shape as `ProfileFileSync` plus which installation. */
export interface ProfileInstallationSync extends ProfileFileSync {
  installationId: string
}

/** `syncState`'s result: the profile's own canonical file, plus one entry per assigned installation. */
export interface ProfileSyncState {
  own: ProfileFileSync
  installations: ProfileInstallationSync[]
}

export interface SyncProfileStateInput {
  profileId: string
}

/** Story 023 D1: `rawFiles`' input - shape-identical to `write`/`syncState`'s. */
export interface RawFilesInput {
  profileId: string
}

/**
 * The profile's own canonical file (story 022's `<name>.cfg`, kept centrally under the launcher's
 * user data dir), read byte-faithfully. `onDisk` is false for a profile that was just created and
 * has no installation assignment yet - that must still be a successful `rawFiles` result (story
 * 023 AC 3), not an error.
 */
export interface RawProfileFile {
  /** Absolute path of the canonical file. */
  path: string
  /** Byte-faithful (latin1) content, or '' when `onDisk` is false. */
  content: string
  onDisk: boolean
}

/**
 * One assigned installation's copy of the profile's file.
 *
 * `matches` is true only when the on-disk bytes equal freshly rendered content, byte-for-byte,
 * latin1 - the same diff-skip comparison the write pipeline (`writer.ts`) already performs, reused
 * rather than reimplemented, so "matches" can never disagree with "a write would change nothing".
 * `playedMods` is that installation's currently configured played-mods list (story 022), echoed
 * back here so the Raw File UI can seed its checkboxes without a second round-trip.
 */
export interface RawInstallationTarget {
  installationId: string
  /** Absolute path of this installation's copy. */
  path: string
  onDisk: boolean
  matches: boolean
  playedMods: string[]
}

/** `rawFiles`' result: the profile's own canonical file, plus one entry per live assignment. */
export interface RawFilesResult {
  canonical: RawProfileFile
  installations: RawInstallationTarget[]
}

/**
 * Story 023 D2: what `openFile` should do with the resolved file - hand it to the OS default
 * application for `.cfg` ('open') or select it in the platform's file manager ('reveal').
 */
export type OpenProfileFileMode = 'open' | 'reveal'

/**
 * Which file `openFile` acts on, addressed by ids only (story 023, Decisions): `installationId:
 * null` means the profile's own canonical file, a non-null value means that installation's copy.
 *
 * No path ever travels from the renderer here. Main resolves the path from its own state and
 * refuses anything that is not this profile's own `.cfg`, so AC 8 ("nothing but the profile's own
 * files can be opened this way") holds by construction rather than by an allowlist check on
 * renderer input - which is also why this is a module-scoped handler rather than a second,
 * generic `app:openPath` channel that could be repurposed to open any launcher-known file.
 */
export interface OpenProfileFileInput {
  profileId: string
  installationId: string | null
  mode: OpenProfileFileMode
}

// ---------------------------------------------------------------------------
// Import (story 005): read an existing hand-written config into a new profile.
// Addressed by `{ installationId, gameDir }`, never by a path (decision 2) -
// main resolves the real path from the registered installation itself.
// ---------------------------------------------------------------------------

export interface ImportScanInput {
  installationId: string
}

/** One gamedir that has at least one importable file (decision 12). */
export interface ImportGamedirCandidate {
  gameDir: string
  hasConfigCfg: boolean
  hasAutoexecCfg: boolean
}

export interface ImportScanResult {
  /** `baseq2` first when present, so "pick candidates[0]" is a correct default. */
  candidates: ImportGamedirCandidate[]
}

export interface ImportPreviewInput {
  installationId: string
  gameDir: string
}

/**
 * One thing `restoreProfileParts` (story 042 D4) had to say about a launcher-written file's
 * metadata, carried across the module boundary as an i18n key plus a `file`/`line` locator -
 * never prose (CLAUDE.md: main sends keys, not sentences). Mirrors `RestoreWarning`
 * (`@shared/config/profile-restore`) field-for-field; `key` is `reason` mapped to
 * `config.import.warning.<reasonCode>` (story 042 D5) - the actual translation strings are D6's
 * job, this only has to be a well-formed, stable key.
 */
export interface ImportMetadataWarning {
  key: string
  file: string
  line: number
  /** The offending value itself when there is one - file data, never generated prose. */
  subject?: string
}

export interface ImportPreviewResult {
  cvarCount: number
  bindCount: number
  /**
   * Story 041 (D6): number of `alias <name> <body>` definitions the import
   * found - `result.aliases.length` in `import-reader.ts`'s terms, counted the
   * same way `cvarCount`/`bindCount` count their own maps.
   */
  aliasCount: number
  /**
   * Story 041 (D6): of those alias definitions, how many convert to a
   * `kind: 'message'` entry (a body that is exactly one `say`/`say_team`
   * command, per `alias-import.ts#entryKindFor`) rather than a `kind: 'alias'`
   * one - a preview-only sub-count, computed by calling `buildImportedActions`
   * with an empty `layerAliases` (nothing has been answered yet) and counting
   * its `actions`.
   */
  messageCount: number
  preserved: UnrecognizedConfigLine[]
  filesRead: string[]
  duplicateBinds: DuplicateBindLine[]
  /** Story 041 (D6): mirrors `duplicateBinds` for aliases - `import-reader.ts`'s `duplicateAliases`. */
  duplicateAliases: DuplicateAliasLine[]
  /**
   * Story 041 (D6): every alias whose body rebinds at least one key -
   * `buildImportedActions`'s own `ambiguous` output (`@shared/config/
   * alias-import`), carried through unfiltered so the import dialog can ask
   * the user which of these to "attempt as layer" before `commit` runs. Not
   * affected by which `layerAliases` answer (if any) `preview` used to compute
   * it - the ambiguous list is the same regardless of that answer, only
   * whether an entry becomes a layer or a plain alias changes.
   */
  ambiguousRebindAliases: AmbiguousRebindAlias[]
  /**
   * Story 042 D5: true when the OWNERSHIP_MARKER sentinel (`@shared/config/render`) was found on
   * any file this import read - including a profile file reached only through the loader's `exec`
   * chain (e.g. the user points at `autoexec.cfg`, which `exec`s the actual launcher-written
   * profile file). Computed from `restoreProfileParts`'s own `sourceProfileId` (non-null exactly
   * when the sentinel was found), never re-derived by a second sentinel scan. When true, there was
   * nothing for the ambiguous-alias review step to guess (`restoreProfileParts` already resolved
   * slot pairing deterministically from tags), so the dialog should skip that step entirely.
   */
  ownWrittenFile: boolean
  /**
   * Story 042 D5: the `[q2l v=…]` format version the file was written with, or `null` for a
   * foreign config or a launcher file whose header marker was hand-deleted (`metadataWarnings`
   * tells those two apart) - `restoreProfileParts`'s own `metadataVersion`, passed through.
   */
  metadataVersion: number | null
  /**
   * Story 042 D5: the profile id the file's ownership sentinel names, so the import dialog can say
   * *which* profile is being restored - never adopted as the new profile's id (AC4: a fresh id is
   * always minted, even for a re-import of the same file). `restoreProfileParts`'s own
   * `sourceProfileId`, passed through.
   */
  sourceProfileId: string | null
  /**
   * Story 042 D5: every discrepancy `restoreProfileParts` found between a tag and the config line
   * it sits on, or an unreadable/missing metadata marker - `RestoreWarning.reason` mapped to an
   * i18n key. Empty for a foreign config (nothing to reconcile) and for a clean launcher-written
   * file.
   */
  metadataWarnings: ImportMetadataWarning[]
  /**
   * Story 059 D5: the cvar sections `commitImport` would store on the created profile -
   * `restoreProfileParts`'s own `cvarSections`, passed through unchanged so the preview reflects
   * exactly what commit produces rather than a second, potentially stale computation. Empty for a
   * file with no cvar-group banners at all (every cvar reads back unplaced - the reserved `Other`
   * bucket is the absence of a section, not a section of its own).
   */
  cvarSections: ConfigCvarSection[]
}

export interface ImportCommitInput {
  installationId: string
  gameDir: string
  name: string
  /**
   * Story 041 (D6): names (from `ImportPreviewResult.ambiguousRebindAliases`)
   * the user chose to "attempt as layer" - passed straight through to
   * `buildImportedActions`'s own `layerAliases` parameter. Optional, absent or
   * empty meaning the default for every ambiguous alias (import as a plain
   * `kind: 'alias'` entry) - same convention as that function's own optional
   * parameter, and what keeps every caller that predates this deliverable (the
   * import dialog has no UI for it yet) compiling and behaving unchanged.
   * Validated at commit time against *that import's own* ambiguous list (never
   * trust a renderer-supplied name) - `main/modules/config/import.ts#commitImport`.
   */
  layerAliases?: string[]
}

// ---------------------------------------------------------------------------
// Cleanup (story 010): find and remove mod-folder `.cfg` copies that duplicate
// a same-named `baseq2` file, so a stale mod-folder override the user forgot
// about does not silently win over the base game's config. Addressed by
// `{ installationId, entries: [{ gameDir, fileName }] }`, never by a path
// (decision 7) - main resolves every path from the registered installation
// itself. Mirrors `cleanup.ts`'s own local types (main-only, D1/D2) - this is
// the shared, renderer-facing shape.
// ---------------------------------------------------------------------------

/** One mod-folder `.cfg` file that duplicates a same-named `baseq2` file. */
export interface CleanupFinding {
  /** One of `installation.gameDirs` - the mod folder the redundant copy lives in. */
  gameDir: string
  /** File name only, as it appears on disk inside `gameDir`. */
  fileName: string
  /** True when the mod-folder copy is byte-identical (latin1) to the baseq2 file of the same name. */
  identical: boolean
  /** Byte size of the mod-folder copy, or null if it could not be stat'd. */
  size: number | null
}

/** How a caller addresses one redundant copy: an id, never a path (decision 7). */
export interface CleanupEntry {
  /** One of `installation.gameDirs`, never `baseq2`, never a path. */
  gameDir: string
  /** Bare file name inside `gameDir`. */
  fileName: string
}

export interface CleanupScanInput {
  installationId: string
}

export interface CleanupScanResult {
  findings: CleanupFinding[]
}

export interface CleanupApplyInput {
  installationId: string
  entries: CleanupEntry[]
}

export interface CleanupApplyResult {
  /** Entries whose file was backed up and then deleted by this call. */
  removed: CleanupEntry[]
  /** Entries this call did not act on - untrusted, no longer a finding, or a repeat. */
  rejected: CleanupEntry[]
}

export interface CleanupRestoreInput {
  installationId: string
  entries: CleanupEntry[]
}

export interface CleanupRestoreResult {
  /** Entries whose backup was copied back into place by this call. */
  restored: CleanupEntry[]
  /** Entries this call did not act on - untrusted, no backup, or the file is already there. */
  rejected: CleanupEntry[]
}

// ---------------------------------------------------------------------------
// Tidy-up (story 025 D3)
// ---------------------------------------------------------------------------

/**
 * One atomic tidy-up batch: whatever the Care tab's fixable findings resolved to
 * (`TidyUpOp`, `@shared/config/tidy-up`), applied to one profile.
 *
 * Deliberately *not* the four whole-field setters (`setCvars`/`setBinds`/
 * `setLayers`/`setActions`, decision 10): a re-classify touches `unrecognized`
 * plus one of `cvars`/`binds`/`actions` in the same result, so two setter calls
 * would bump `updatedAt` twice and write two half-tidied files to every
 * installation the profile is assigned to. `unrecognized` has no setter at all
 * today; this is its first write path.
 */
export interface TidyUpApplyInput {
  profileId: string
  ops: TidyUpOp[]
}

/**
 * The result of one batch. `applied` and `rejected` echo the submitted ops back
 * (same convention as `CleanupApplyResult`): main re-validates every op against
 * the *current* profile and returns the no-longer-applicable ones instead of
 * throwing (decision 11), so a caller can tell what it got and re-scan for the
 * rest. `profile` is the committed profile - `updatedAt` bumped exactly once
 * when anything applied, and untouched when nothing did.
 */
export interface TidyUpApplyResult {
  profile: ConfigProfile
  applied: TidyUpOp[]
  rejected: TidyUpOp[]
}
