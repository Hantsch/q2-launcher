import type { AltLayer } from '../config/alt-layers'
import type { AmbiguousRebindAlias } from '../config/alias-import'
import type { ModifierTrigger } from '../config/modifier-layers'
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
  preview: 'preview',
  writeState: 'writeState',
  syncState: 'syncState',
  rawFiles: 'rawFiles',
  openFile: 'openFile',
  setPlayedMods: 'setPlayedMods',
  switchBinds: 'switchBinds',
  setSwitchBind: 'setSwitchBind',
  setWriteUnbindall: 'setWriteUnbindall',
  setSectionHeaderStyle: 'setSectionHeaderStyle',
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
 */
export type ActionEntryKind = 'bind' | 'message' | 'alias'

/** A built-in category — a shared constant, never persisted (decision: profiles only persist
 * their custom categories, so built-in labels stay translatable and adding one needs no
 * migration).
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

/** Exactly the three the story's AC names, matching upstream's `group: 'main'` set. */
export const BUILT_IN_ACTION_CATEGORIES: readonly BuiltInActionCategory[] = [
  { id: 'movement', labelKey: 'config.controls.categories.movement', label: 'Movement' },
  { id: 'weapons', labelKey: 'config.controls.categories.weapons', label: 'Weapons' },
  { id: 'drops', labelKey: 'config.controls.categories.drops', label: 'Weapon dropping' },
]

/** A user-defined category. Its `name` is user-typed text (not translatable UI prose, hence a
 * plain string, unlike `BuiltInActionCategory.labelKey`). Persisted on `ConfigProfile.categories`
 * — built-ins above are never persisted rows. Carries no entry kind (story 019): what is typed is
 * the entry (`ConfigAction.kind`), not the drawer it sits in. */
export interface ConfigActionCategory {
  id: string
  name: string
}

export type ConfigCommand =
  | { kind: 'raw'; text: string }
  | { kind: 'message'; channel: 'say' | 'say_team'; text: string }

/**
 * One shape for all three entry kinds (bind/message/alias): a message and a multi-command bind
 * are the same thing to the engine (an alias body), so one type serves both instead of two
 * parallel entities needing two renderers/validators. `categoryId` may reference either a
 * `BUILT_IN_ACTION_CATEGORIES` id or a `ConfigProfile.categories` custom category's id.
 * `key`, when set, is the engine key name this action's generated alias is bound to. `bind` and
 * `message` entries may be keyed (a message can sit on a key exactly like a multi-command bind
 * can); a `kind: 'alias'` entry never is — it exists to be referenced by name, not bound, and the
 * UI offers no key slot for it at all (story 019).
 *
 * `secondaryKey` (story 015, decision 1) is a second key bound to the *same* generated alias —
 * the engine has no notion of a "primary" and "secondary" bind, so a two-slot row is two `binds`
 * entries pointing at one alias rather than two duplicate actions. Optional and purely additive:
 * a pre-015 action simply omits it, so there is no migration and one-slot rows stay exactly as
 * they were.
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
 * `keyModifier`/`secondaryKeyModifier` (story 016) record the modifier - `ALT`/`CTRL`/`SHIFT` -
 * that was held while capturing `key`/`secondaryKey` respectively. Quake 2 itself has no notion of
 * a modified bind (see `modifier-layers.ts`'s file doc comment): a captured "Alt+R" is not stored
 * as a literal bind at all. These two fields are the authoritative source the write pipeline
 * consults: `setActions`/`setLayers` (`main/modules/config/profiles.ts`) derive every modifier
 * layer's overrides from them via `applyActionLayerMirror`, skipping the matching key from the
 * base `binds` mirror - a layer override is a generated mirror of these fields, never a second
 * place they could drift from. Optional and additive like `secondaryKey`/`catalogId`: a pre-016
 * action simply omits them, and a plain (unmodified) key or slot omits the corresponding field too.
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
 */
export interface ConfigAction {
  id: string
  categoryId: string
  name: string
  kind: ActionEntryKind
  commands: ConfigCommand[]
  key?: string
  secondaryKey?: string
  catalogId?: string
  keyModifier?: ModifierTrigger
  secondaryKeyModifier?: ModifierTrigger
  aliasName?: string
  keepEmptyAlias?: true
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
  writeUnbindall?: boolean
  sectionHeaderStyle?: 'dashes' | 'brackets' | 'plain'
}

/** Where a new profile's content comes from. */
export type ConfigProfileSeed = 'empty' | 'template'

/**
 * The read-only seed a profile can be created from. Read-only on purpose: a
 * profile's own maps are mutable, so a caller has to copy this rather than
 * hand the shared module-level object to a profile that is about to be edited.
 */
export interface ConfigProfileTemplate {
  readonly cvars: Readonly<Record<string, string>>
  readonly binds: Readonly<Record<string, string>>
}

/**
 * A deliberately minimal seed of vanilla Quake II defaults, so that "create
 * from template" is visibly different from "create empty". The full,
 * source-cited cvar catalogue belongs to the settings/cvar editor story - this
 * is not it, and it is not meant to be exhaustive.
 */
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

export interface SetProfileCvarsInput {
  profileId: string
  cvars: Record<string, string>
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
 * Story 042 D7: sets one profile's `sectionHeaderStyle` - a dedicated handler mirroring
 * `SetWriteUnbindallInput`/`setWriteUnbindall` exactly, just a 3-way enum in place of a boolean.
 */
export interface SetSectionHeaderStyleInput {
  profileId: string
  sectionHeaderStyle: 'dashes' | 'brackets' | 'plain'
}

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
