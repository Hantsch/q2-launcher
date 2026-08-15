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
  write: 'write',
  preview: 'preview',
  writeState: 'writeState',
  setPlayedMods: 'setPlayedMods',
  importScan: 'import.scan',
  importPreview: 'import.preview',
  importCommit: 'import.commit',
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
}

export interface PreviewProfileResult {
  files: PreviewFile[]
}

export interface SetPlayedModsInput {
  installationId: string
  playedMods: string[]
}

/**
 * Which installation is currently waiting for a retry, and for which profile -
 * i.e. the last `write` attempt found it running and skipped it. Keyed by
 * installationId; an installation absent from this map has nothing pending.
 */
export type WriteState = Record<string, string>

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
}

export interface ImportCommitInput {
  installationId: string
  gameDir: string
  name: string
}
