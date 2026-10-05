import type { AltLayer } from '../config/aliases/alt-layers'
import type { AmbiguousRebindAlias } from '../config/aliases/alias-import'
// `catalog-rows.ts` imports `ConfigCommand` back from this file, but only as an `import type` -
// erased at compile time, so this is a value import into a type-only cycle, not a runtime one.
import { allCatalogRows, commandsForRow, nameForCatalogRow } from '../config/catalog/catalog-rows'
import { ALL_CVARS } from '../config/catalog/cvar-catalog'
import { CVAR_GROUP_LABELS, CVAR_GROUP_ORDER, type CvarDef } from '../config/catalog/cvar-facts'
import type { ModifierTrigger } from '../config/aliases/modifier-layers'
// Type-only both ways: `profile-baseline.ts` needs `ConfigProfile` to describe what it snapshots,
// this file needs its result type.
import type { ProfileBaseline } from '../config/profile/profile-baseline'
import type { TidyUpOp } from '../config/profile/tidy-up'
import type { z } from 'zod'
// Type-only back-reference: `config-schemas.ts` imports `CONFIG_HANDLERS` from here as a value, so
// a value import in this direction would be a runtime cycle.
import type { CONFIG_HANDLER_SCHEMAS } from './config-schemas'

/** The config module's contract. */
export const CONFIG_HANDLERS = {
  list: 'list',
  create: 'create',
  rename: 'rename',
  remove: 'remove',
  assign: 'assign',
  unassign: 'unassign',
  setDefault: 'setDefault',
  setCvars: 'setCvars',
  commitCvars: 'commitCvars',
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
  // The file-id-addressed import trio - see `PickedConfigFile`'s doc comment.
  importPickFiles: 'import.pickFiles',
  importPreviewFiles: 'import.previewFiles',
  importCommitFiles: 'import.commitFiles',
  cleanupScan: 'cleanup.scan',
  cleanupApply: 'cleanup.apply',
  cleanupRestore: 'cleanup.restore',
  tidyUpApply: 'tidyUp.apply',
} as const

/**
 * One installation's link to a profile: the installation is assigned the profile's cvars and binds,
 * and `isDefault` marks whether this is the installation's default profile.
 */
export interface ProfileAssignment {
  installationId: string
  isDefault: boolean
}

/**
 * A line of a hand-written config the importer did not recognize, kept verbatim rather than
 * dropped.
 */
export interface UnrecognizedConfigLine {
  /** On-disk file name the line came from, e.g. `config.cfg`. */
  file: string
  /** 1-based line number within that file. */
  line: number
  text: string
}

/**
 * A key name whose `bind` command was silently replaced by a later `bind` of the same key while
 * importing, with no intervening `unbind`/`unbindall` of that key.
 */
export interface DuplicateBindLine {
  key: string
  file: string
  line: number
}

/**
 * An alias name whose `alias` definition was silently replaced by a later `alias` of the same name
 * while importing.
 */
export interface DuplicateAliasLine {
  name: string
  file: string
  line: number
}

/** What one entry *is*: a bind, a named chat message, or an alias definition. */
export type ActionEntryKind = 'bind' | 'message' | 'alias' | 'toggle' | 'press-release'

/**
 * A template category: the seed source `STANDARD_TEMPLATE` and "New category -> from template"
 * draw from; categories are ordinary profile-owned data, nothing here is always shown. `label` is
 * the ASCII English text `labelKey` resolves to, for main-side code that cannot import i18n.
 */
export interface BuiltInActionCategory {
  id: string
  labelKey: string
  label: string
}

/** Matches upstream's `group: 'main'` set; seeds `STANDARD_TEMPLATE.categories`. */
export const TEMPLATE_ACTION_CATEGORIES: readonly BuiltInActionCategory[] = [
  { id: 'movement', labelKey: 'config.controls.categories.movement', label: 'Movement' },
  { id: 'weapons', labelKey: 'config.controls.categories.weapons', label: 'Weapons' },
  { id: 'drops', labelKey: 'config.controls.categories.drops', label: 'Weapon dropping' },
  { id: 'demo', labelKey: 'common.label.demoPlayback', label: 'Demo playback' },
]

/** @deprecated `TEMPLATE_ACTION_CATEGORIES` under its old name; only `ControlsTab.tsx` still uses it. */
export const BUILT_IN_ACTION_CATEGORIES = TEMPLATE_ACTION_CATEGORIES

/**
 * A profile-owned category, persisted on `ConfigProfile.categories`. `name` is always prose, never
 * a bare key across IPC. `nameKey` is a display hint set only by a seed (`{ name: <english
 * default>, nameKey }`) and dropped by any rename; absent for user-typed categories.
 * `subcategories` is the optional second and final level; one level cannot nest further. A
 * `ConfigAction.subcategoryId` matching nothing here is an ungrouped entry, not an error.
 */
export interface ConfigActionCategory {
  id: string
  name: string
  nameKey?: string
  subcategories?: ConfigActionSubcategory[]
}

/** One sub-category: user-typed `name`, never seeded from a translated built-in, so no `nameKey`. */
export interface ConfigActionSubcategory {
  id: string
  name: string
}

/**
 * A profile-owned grouping of cvars, the Settings-tab counterpart of `ConfigActionCategory` with
 * the same `name`/`nameKey` rules. `cvars` is not cross-validated against the catalogue; an unknown
 * name is simply not shown where the catalogue is consulted.
 */
export interface ConfigCvarSection {
  id: string
  name: string
  nameKey?: string
  cvars: string[]
  subsections?: ConfigCvarSubsection[]
}

/** One sub-section: second and final level, user-typed, never seeded, so no `nameKey`. */
export interface ConfigCvarSubsection {
  id: string
  name: string
  cvars: string[]
}

export type ConfigCommand =
  | { kind: 'raw'; text: string }
  | { kind: 'message'; channel: 'say' | 'say_team'; text: string }
  /** A `wait <frames>` step; `frames` is capped by `MAX_WAIT_FRAMES`, a launcher sanity cap. */
  | { kind: 'wait'; frames: number }

/**
 * One shape for all entry kinds: a message and a multi-command bind are both an alias body to the
 * engine. A `categoryId` matching no category is an uncategorised entry, written to the "Other" bucket.
 */
export interface ConfigAction {
  id: string
  categoryId: string
  /** Unmatched or absent means ungrouped within the category, never an error. */
  subcategoryId?: string
  name: string
  /** Required: a `setActions` payload without it is rejected; old rows derive it from the category's legacy `entryKind`. */
  kind: ActionEntryKind
  /** Empty for `'toggle'`/`'press-release'`: both halves live in `parts`. */
  commands: ConfigCommand[]
  /**
   * Every key the generated alias is bound to; slot identity is array order, so only
   * `action-slots.ts` reads or writes it. An `'alias'` entry is never keyed. Modifier layers are
   * mirrored from it (`applyActionLayerMirror`), never a second source.
   */
  keys?: readonly ActionKeySlot[]
  /** Marks the materialised catalogue row; identity lives here, never in `name`. Absent means free-form. */
  catalogId?: string
  /** The user-typed alias name, written verbatim; else a generated `q2l_a_<slug>_<id4>` name. */
  aliasName?: string
  /** Set only by the importer so an empty-body `alias <name> ""` survives the first save. */
  keepEmptyAlias?: true
  /** Exactly two parts for `'toggle'`/`'press-release'`, absent for every other kind. */
  parts?: ActionEntryPart[]
}

/**
 * One state's worth of commands for a two-part `ConfigAction` (`kind: 'toggle'` or `kind:
 * 'press-release'`).
 */
export interface ActionEntryPart {
  commands: ConfigCommand[]
  /** Optional user-facing state name, e.g. "on"/"off". */
  label?: string
  /** Same verbatim-name affordance as `ConfigAction.aliasName`, per part. */
  aliasName?: string
}

/**
 * One key slot on a `ConfigAction` - the engine key this action's generated alias is bound to
 * (`key`), plus the modifier (`modifier`) that was held while capturing it, if any.
 */
export interface ActionKeySlot {
  key: string
  modifier?: ModifierTrigger
}

/**
 * A config profile: a named set of cvars and key binds, owned centrally rather than by one
 * installation, and identified by a generated `id` so renaming it never breaks a reference.
 */
export interface ConfigProfile {
  /** Generated, so renaming never breaks a reference. */
  id: string
  name: string
  createdAt: string
  updatedAt: string
  cvars: Record<string, string>
  binds: Record<string, string>
  assignments: ProfileAssignment[]
  /** Set only by an import: lines it could not classify, kept so they are never silently dropped. */
  unrecognized?: UnrecognizedConfigLine[]
  /** Alternate binding layers whose overrides sit on top of `binds`. */
  layers?: AltLayer[]
  categories?: ConfigActionCategory[]
  actions?: ConfigAction[]
  /** Seeded only by `from: 'template'`; the Settings tab groups by it. */
  cvarSections?: ConfigCvarSection[]
  /** Whether the `.cfg` opens with `unbindall`; absent means `true`. */
  writeUnbindall?: boolean
  /** Whether a `set` line is still written for catalogue cvars no section mentions; absent means `true`. */
  writeCatalogDefaults?: boolean
  /** Section banner decoration in the `.cfg`; absent renders as `'dashes'`. */
  sectionHeaderStyle?: 'dashes' | 'brackets' | 'plain'
  /** sha-256 of the canonical file's latin1 bytes; the launcher's own write seeds it so it is never read back as an external edit. */
  fileHash?: string
  /** Epoch ms `fileHash` was last confirmed. */
  fileSeenAt?: number
  /** Read-only cache of the last `readFileState` classification. */
  dirty?: boolean
  fileState?: ProfileFileState
  /** Render-relevant state when launcher and `.cfg` last agreed: what "unsaved" is measured against and discard restores. Absent means no known saved state. */
  baseline?: ProfileBaseline
  /** Which seed it was created from: `'template-right'` or `'template-left'`, never `'empty'`; absent for imports. */
  seedFrom?: Exclude<ConfigProfileSeed, 'empty'>
}

/**
 * Which of the five outcomes `readFileState` (`main/modules/config/file-source.ts`) classified the
 * profile's canonical file into, relative to its previously cached `fileHash`.
 */
export type ProfileFileState =
  'unchanged' | 'changedOnDisk' | 'missing' | 'unparseable' | 'readError'

/** Where a new profile's content comes from; template seeds both use `STANDARD_TEMPLATE` and record the choice in `seedFrom`. */
export type ConfigProfileSeed = 'empty' | 'template-right' | 'template-left'

/** The read-only seed a profile is created from; callers must copy it, never hand it to a profile that will be edited. */
export interface ConfigProfileTemplate {
  readonly cvars: Readonly<Record<string, string>>
  readonly binds: Readonly<Record<string, string>>
  readonly categories: readonly ConfigActionCategory[]
  readonly actions: readonly ConfigAction[]
  readonly cvarSections: readonly ConfigCvarSection[]
}

/**
 * Catalogue rows `STANDARD_TEMPLATE.binds` already names (five movement commands plus `+attack`);
 * they keep their real command so `adoptRawBinds` recognises the bind as this row, not a duplicate.
 */
export const TEMPLATE_BOUND_CATALOG_IDS = new Set(
  ['forward', 'back', 'moveup', 'movedown', 'speed', 'attack'].map((id) => `movement:${id}`),
)

/** The five sub-categories the template seeds: literal English names, no `nameKey` (structure is user data). */
const WEAPONS_USE_SUBCATEGORY_ID = 'weapons-use'
const WEAPONS_CYCLING_SUBCATEGORY_ID = 'weapons-cycling'
const DROPS_WEAPONS_SUBCATEGORY_ID = 'drops-weapons'
const DROPS_AMMO_SUBCATEGORY_ID = 'drops-ammo'
const DROPS_MISC_SUBCATEGORY_ID = 'drops-misc'

/** `CatalogRowKind` prefix -> template sub-category; a prefix missing here (`movement`) stays ungrouped. */
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

/** One action per catalogue row; only the six bound rows carry commands, the rest are unbound (`[]`). */
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
 * `CVAR_GROUP_ORDER`'s groups as persisted `ConfigCvarSection` rows (id = group name, catalogue
 * order); `include` narrows each to the names a migrating profile actually has.
 */
export function buildTemplateCvarSections(
  include?: (name: string) => boolean,
): ConfigCvarSection[] {
  return CVAR_GROUP_ORDER.map((group) => ({
    id: group,
    name: CVAR_GROUP_LABELS[group],
    nameKey: `config.settings.groups.${group}`,
    cvars: ALL_CVARS.filter(
      (def: CvarDef) => def.group === group && (!include || include(def.name)),
    ).map((def: CvarDef) => def.name),
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
 * `cvarSections` is optional and additive: omitting it leaves the profile's stored `cvarSections`
 * untouched ("send nothing, change nothing"), unlike the required whole-field replaces.
 */
export interface SetProfileCvarsInput {
  profileId: string
  cvars: Record<string, string>
  cvarSections?: ConfigCvarSection[]
}

/**
 * The `commitCvars` payload - the one writer that puts content on a profile's disk without `save`.
 * Only the named cvars are committed, on top of the last-saved baseline; any other pending edit
 * stays unsaved.
 */
export interface CommitProfileCvarsInput {
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
export type WriteTargetStatus = 'written' | 'unchanged' | 'error'

export interface WriteTargetResult {
  installationId: string
  status: WriteTargetStatus
  /** Set when status is 'error'. i18n key. */
  messageKey?: string
}

export interface WriteProfileInput {
  profileId: string
  /**
   * Restricts this write to one installation's copy; validated against known installation ids in main
   * (`installations.error.notFound`), never trusted as a bare string. The copy is rewritten from the
   * canonical file, never from a dirty profile's unsaved edits.
   */
  installationId?: string
}

/** `save` - the one operation that writes a profile's content to disk now. */
export interface SaveProfileInput {
  profileId: string
  /**
   * The "overwrite with my version" resolution: skips the conflict check and writes the cached
   * render. Set only right after the user was shown a `SaveProfileConflict` and chose to keep theirs.
   */
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
 * The file changed underneath the launcher since it last read or wrote it, so nothing was written:
 * the launcher never overwrites a hand-edit it has not read. Both whole texts are carried, not a diff.
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
 * produced no valid profile (`unparseable`). Never a write: treated like a changed file, since the
 * launcher has not read it either.
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
 * `saveRawText` - the Raw file tab's inline editor saving the text the user typed straight onto the
 * profile's canonical `.cfg`, byte for byte. There is no path field: main resolves the target file
 * from the profile's ownership stamp.
 */
export interface SaveRawTextInput {
  profileId: string
  /** The complete file content to write, latin-1 text. */
  text: string
  /** Same overwrite resolution as `SaveProfileInput.force`: skip the conflict check, write `text`. */
  force?: boolean
}

/** The typed text is on disk and the profile has been brought in line with it. */
export interface SaveRawTextSaved {
  status: 'saved'
  /** Name the profile's canonical file actually carries on disk - the file this write landed in. */
  fileName: string
  path: string
  /** The profile as adopted from the freshly written file, `fileHash` reseeded from those bytes. */
  profile: ConfigProfile
  /**
   * Alias names the written text defines more than once, so the adopted profile is missing
   * whatever the earlier definition of each said - the same field, from the same fold, as
   * `RefreshedProfileResult`'s `adopted` branch carries.
   */
  droppedAliases: string[]
  /**
   * Lines of the written file the launcher kept verbatim but does not model as a
   * cvar/bind/alias - they live in the file (which is the source of truth) but not in the
   * structured profile, so the next *structured* save would render them away.
   */
  preservedLines: UnrecognizedConfigLine[]
}

/**
 * Reuses `save`'s own `conflict`/`unreadable` shapes rather than declaring look-alikes, so the
 * renderer handles one conflict concept and one unreadable concept for both save paths.
 */
export type SaveRawTextResult = SaveRawTextSaved | SaveProfileConflict | SaveProfileUnreadable

/**
 * `refreshFromFiles` - the re-read on window focus, tab open and before write.
 */
export interface RefreshFromFilesInput {
  profileId?: string
  discardLocalEdits?: boolean
}

/**
 * One profile's outcome from a `refreshFromFiles` call, discriminated on `outcome` rather than on
 * `fileState` alone: `readFileState`'s own `changedOnDisk` classification covers two different
 * results here depending on whether the profile carried unsaved edits at the time - adopted (no
 * conflict) or a conflict - so `fileState` alone cannot tell the two apart.
 */
export type RefreshedProfileResult =
  | { profileId: string; outcome: 'unchanged'; fileState: 'unchanged' }
  | {
      profileId: string
      outcome: 'adopted'
      fileState: 'changedOnDisk'
      profile: ConfigProfile
      /**
       * Alias names the file defined more than once, so the adopted profile is missing
       * whatever the earlier definition of each said.
       */
      droppedAliases: string[]
    }
  | {
      profileId: string
      outcome: 'conflict'
      fileState: 'changedOnDisk'
      /**
       * Same whole-file conflict shape `save` already returns for its own `changedOnDisk` case
       * - reused rather than duplicated, so the renderer never has to
       * handle two different shapes for the same concept.
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
   * Whether `path` already exists as a file on disk, checked by the `preview` handler in main
   * at preview time - never by this pure, shared type or by the renderer itself.
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

/** Which key (if any) cycles an installation's assigned profiles in-session. */
export interface SetSwitchBindInput {
  installationId: string
  /** null clears the bind for that installation. */
  key: string | null
}

/**
 * Sets one profile's `writeUnbindall` flag - a dedicated handler rather than routed through
 * `setCvars`/`setBinds`/`setLayers`/`setActions`.
 */
export interface SetWriteUnbindallInput {
  profileId: string
  writeUnbindall: boolean
}

/**
 * Sets one profile's `writeCatalogDefaults` flag - a dedicated handler mirroring
 * `SetWriteUnbindallInput`/`setWriteUnbindall` exactly, just a different boolean field.
 */
export interface SetWriteCatalogDefaultsInput {
  profileId: string
  writeCatalogDefaults: boolean
}

/**
 * Sets one profile's `sectionHeaderStyle` - a dedicated handler mirroring
 * `SetWriteUnbindallInput`/`setWriteUnbindall` exactly, just a 3-way enum in place of a boolean.
 */
export interface SetSectionHeaderStyleInput {
  profileId: string
  sectionHeaderStyle: 'dashes' | 'brackets' | 'plain'
}

/**
 * `discard`'s input - a profile id, nothing else: it always restores `profile.baseline`, never a
 * partial or caller-chosen undo.
 */
export interface DiscardProfileInput {
  profileId: string
}

/**
 * `discard` restored the profile's render-relevant fields to its `baseline` and returns the full,
 * updated profile list.
 */
export interface DiscardProfileDiscarded {
  status: 'discarded'
  profiles: ConfigProfile[]
}

/**
 * The profile named by `discard`'s input has no `baseline` - never saved, or a legacy
 * `state.json` record with `dirty === true` and nothing to fall back to.
 */
export interface DiscardProfileNoBaseline {
  status: 'noBaseline'
}

export type DiscardProfileResult = DiscardProfileDiscarded | DiscardProfileNoBaseline

/**
 * Which installation is currently waiting for a retry, and for which profile - i.e. the last
 * `write` attempt found it running and skipped it.
 */
export type WriteState = Record<string, string>

/** Per-file sync status the write pipeline can report. */
export type ProfileFileSyncStatus = 'inSync' | 'outOfSync' | 'missing' | 'error'

/** One file's sync status: the canonical copy, or one installation's copy. */
export interface ProfileFileSync {
  /** Absolute path of the file this status describes. */
  path: string
  /** File name only (matches `resolveProfileFileNames`' output for this profile). */
  fileName: string
  status: ProfileFileSyncStatus
  /** Set when status is 'error'. i18n key, never prose. */
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

/** `rawFiles`' input - shape-identical to `write`/`syncState`'s. */
export interface RawFilesInput {
  profileId: string
}

/** The profile's own canonical file, read byte-faithfully. */
export interface RawProfileFile {
  /** Absolute path of the canonical file. */
  path: string
  /** Byte-faithful (latin1) content, or '' when `onDisk` is false. */
  content: string
  onDisk: boolean
}

/** One assigned installation's copy of the profile's file. */
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
 * What `openFile` should do with the resolved file - hand it to the OS default application for
 * `.cfg` ('open') or select it in the platform's file manager ('reveal').
 */
export type OpenProfileFileMode = 'open' | 'reveal'

/**
 * Which file `openFile` acts on, addressed by ids only: `installationId: null` means the profile's
 * own canonical file, a non-null value means that installation's copy. No path travels from the
 * renderer: main resolves it and refuses anything that is not the profile's own `.cfg`, which is why
 * there is no generic `app:openPath`.
 */
export interface OpenProfileFileInput {
  profileId: string
  installationId: string | null
  mode: OpenProfileFileMode
}

// --------------------------------------------------------------------------- Import: read an
// existing hand-written config into a new profile.

/**
 * One thing `restoreProfileParts` had to say about a launcher-written file's metadata, carried
 * across the module boundary as an i18n key plus a `file`/`line` locator - never prose.
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
  /** Number of `alias <name> <body>` definitions the import found. */
  aliasCount: number
  /** Of those alias definitions, how many convert to a `kind: 'message'` entry. */
  messageCount: number
  preserved: UnrecognizedConfigLine[]
  filesRead: string[]
  duplicateBinds: DuplicateBindLine[]
  /** Mirrors `duplicateBinds` for aliases - `import-reader.ts`'s `duplicateAliases`. */
  duplicateAliases: DuplicateAliasLine[]
  /** Every alias whose body rebinds at least one key. */
  ambiguousRebindAliases: AmbiguousRebindAlias[]
  /** True when the OWNERSHIP_MARKER sentinel. */
  ownWrittenFile: boolean
  /**
   * The `[q2l v=…]` format version the file was written with, or `null` for a foreign config
   * or a launcher file whose header marker was hand-deleted (`metadataWarnings` tells those
   * two apart) - `restoreProfileParts`'s own `metadataVersion`, passed through.
   */
  metadataVersion: number | null
  /**
   * The profile id the file's ownership sentinel names, so the import dialog can say *which*
   * profile is being restored - never adopted as the new profile's id.
   */
  sourceProfileId: string | null
  /**
   * Every discrepancy `restoreProfileParts` found between a tag and the config line it sits
   * on, or an unreadable/missing metadata marker - `RestoreWarning.reason` mapped to an i18n
   * key.
   */
  metadataWarnings: ImportMetadataWarning[]
  /** The cvar sections `commitImport` would store on the created profile. */
  cvarSections: ConfigCvarSection[]
}

// --------------------------------------------------------------------------- Import from files:
// the renderer-driven multi-file picker that replaces the `{ installationId, gameDir }` addressing
// above.

/**
 * The opaque handle `import.pickFiles` hands the renderer for one file the user picked -
 * deliberately carries no absolute path field. Main keeps the real path in a session-scoped registry
 * keyed by `id`; the renderer only sends ids back, in load order, to `import.previewFiles` and
 * `import.commitFiles`.
 */
export interface PickedConfigFile {
  id: string
  /** Bare file name, for display only (e.g. `dm.cfg`). */
  fileName: string
  /** The containing folder's own display name, for telling apart same-named files from different folders. */
  dirName: string
}

/**
 * `import.previewFiles`' input: the picked files to fold, left to right, into one preview - a later
 * assignment.
 */
export interface ImportFilesPreviewInput {
  fileIds: string[]
}

/**
 * `import.commitFiles`' input: same `fileIds` ordering as `ImportFilesPreviewInput`, plus the new
 * profile's `name`, and `layerAliases` (optional; absent or empty means the default for every
 * ambiguous alias). Commit re-reads the picked files from disk rather than trusting the preview.
 */
export interface ImportFilesCommitInput {
  fileIds: string[]
  name: string
  layerAliases?: string[]
}

// --------------------------------------------------------------------------- Cleanup: find and
// remove mod-folder `.cfg` copies that duplicate a same-named `baseq2` file, so a stale mod-folder
// override the user forgot about does not silently win over the base game's config.

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

// --------------------------------------------------------------------------- Tidy-up
// ---------------------------------------------------------------------------.

/**
 * One atomic tidy-up batch: whatever the Care tab's fixable findings resolved to (`TidyUpOp`,
 * `@shared/config/profile/tidy-up`), applied to one profile. Deliberately not the whole-field
 * setters: a re-classify touches `unrecognized` plus one other field, and two setter calls would
 * write two half-tidied files to every assigned installation.
 */
export interface TidyUpApplyInput {
  profileId: string
  ops: TidyUpOp[]
}

/**
 * The result of one batch. Main re-validates every op against the current profile and returns the
 * no-longer-applicable ones in `rejected` instead of throwing; `updatedAt` is bumped once, and only
 * when something applied.
 */
export interface TidyUpApplyResult {
  profile: ConfigProfile
  applied: TidyUpOp[]
  rejected: TidyUpOp[]
}

type ConfigSchemas = typeof CONFIG_HANDLER_SCHEMAS
type ConfigReq<K extends keyof ConfigSchemas> = z.infer<ConfigSchemas[K]>

/**
 * The config module's typed contract; `req` is each schema's parsed output. In-band results such
 * as `SaveProfileResult`'s `'conflict'` are part of `res`, not failures. Config emits no events.
 */
export type ConfigContract = {
  handlers: {
    [CONFIG_HANDLERS.list]: { req: ConfigReq<'list'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.create]: { req: ConfigReq<'create'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.rename]: { req: ConfigReq<'rename'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.remove]: { req: ConfigReq<'remove'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.assign]: { req: ConfigReq<'assign'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.unassign]: { req: ConfigReq<'unassign'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.setDefault]: { req: ConfigReq<'setDefault'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.setCvars]: { req: ConfigReq<'setCvars'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.commitCvars]: { req: ConfigReq<'commitCvars'>; res: ConfigProfile }
    [CONFIG_HANDLERS.setBinds]: { req: ConfigReq<'setBinds'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.setLayers]: { req: ConfigReq<'setLayers'>; res: ConfigProfile[] }
    [CONFIG_HANDLERS.setActions]: { req: SetProfileActionsInput; res: ConfigProfile[] }
    [CONFIG_HANDLERS.write]: { req: ConfigReq<'write'>; res: WriteTargetResult[] }
    [CONFIG_HANDLERS.save]: { req: ConfigReq<'save'>; res: SaveProfileResult }
    [CONFIG_HANDLERS.saveRawText]: { req: ConfigReq<'saveRawText'>; res: SaveRawTextResult }
    [CONFIG_HANDLERS.refreshFromFiles]: {
      req: ConfigReq<'refreshFromFiles'>
      res: RefreshFromFilesResult
    }
    [CONFIG_HANDLERS.preview]: { req: ConfigReq<'preview'>; res: PreviewProfileResult }
    [CONFIG_HANDLERS.writeState]: { req: ConfigReq<'writeState'>; res: WriteState }
    [CONFIG_HANDLERS.syncState]: { req: ConfigReq<'syncState'>; res: ProfileSyncState }
    [CONFIG_HANDLERS.rawFiles]: { req: ConfigReq<'rawFiles'>; res: RawFilesResult }
    [CONFIG_HANDLERS.openFile]: { req: ConfigReq<'openFile'>; res: null }
    [CONFIG_HANDLERS.setPlayedMods]: { req: ConfigReq<'setPlayedMods'>; res: string[] }
    /** installationId -> switch key. */
    [CONFIG_HANDLERS.switchBinds]: { req: ConfigReq<'switchBinds'>; res: Record<string, string> }
    [CONFIG_HANDLERS.setSwitchBind]: {
      req: ConfigReq<'setSwitchBind'>
      res: Record<string, string>
    }
    [CONFIG_HANDLERS.setWriteUnbindall]: {
      req: ConfigReq<'setWriteUnbindall'>
      res: ConfigProfile[]
    }
    [CONFIG_HANDLERS.setWriteCatalogDefaults]: {
      req: ConfigReq<'setWriteCatalogDefaults'>
      res: ConfigProfile[]
    }
    [CONFIG_HANDLERS.setSectionHeaderStyle]: {
      req: ConfigReq<'setSectionHeaderStyle'>
      res: ConfigProfile[]
    }
    [CONFIG_HANDLERS.discard]: { req: ConfigReq<'discard'>; res: DiscardProfileResult }
    [CONFIG_HANDLERS.importPickFiles]: {
      req: ConfigReq<'import.pickFiles'>
      res: PickedConfigFile[]
    }
    [CONFIG_HANDLERS.importPreviewFiles]: {
      req: ConfigReq<'import.previewFiles'>
      res: ImportPreviewResult
    }
    [CONFIG_HANDLERS.importCommitFiles]: {
      req: ConfigReq<'import.commitFiles'>
      res: ConfigProfile[]
    }
    [CONFIG_HANDLERS.cleanupScan]: { req: ConfigReq<'cleanup.scan'>; res: CleanupScanResult }
    [CONFIG_HANDLERS.cleanupApply]: { req: ConfigReq<'cleanup.apply'>; res: CleanupApplyResult }
    [CONFIG_HANDLERS.cleanupRestore]: {
      req: ConfigReq<'cleanup.restore'>
      res: CleanupRestoreResult
    }
    [CONFIG_HANDLERS.tidyUpApply]: { req: ConfigReq<'tidyUp.apply'>; res: TidyUpApplyResult }
  }
  events: {}
}
