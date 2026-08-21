import type { AltLayer } from '../config/alt-layers'
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
 * migration). */
export interface BuiltInActionCategory {
  id: string
  labelKey: string
}

/** Exactly the three the story's AC names, matching upstream's `group: 'main'` set. */
export const BUILT_IN_ACTION_CATEGORIES: readonly BuiltInActionCategory[] = [
  { id: 'movement', labelKey: 'config.controls.categories.movement' },
  { id: 'weapons', labelKey: 'config.controls.categories.weapons' },
  { id: 'drops', labelKey: 'config.controls.categories.drops' },
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

export interface ImportPreviewResult {
  cvarCount: number
  bindCount: number
  preserved: UnrecognizedConfigLine[]
  filesRead: string[]
  duplicateBinds: DuplicateBindLine[]
}

export interface ImportCommitInput {
  installationId: string
  gameDir: string
  name: string
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
