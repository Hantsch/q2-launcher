import type { EngineKind } from './engine'
import type { RunnerChoice } from './runner'

/** How an installation got into the launcher. Also tells the UI where it came from. */
export type InstallationSource =
  | 'manual'
  | 'steam'
  | 'gog'
  | 'epic'
  | 'bethesda'
  | 'retail'
  /** Created (and later downloaded) by the launcher itself. */
  | 'created'
  | 'unknown'

const STORE_MANAGED_SOURCES = new Set<InstallationSource>(['steam', 'gog', 'epic', 'bethesda'])

/**
 * True when a store (Steam, GOG, Epic, Bethesda) owns the files of this installation. Deleting
 * such a folder behind the store's back leaves the store convinced the game is still installed,
 * so the launcher does not offer to.
 */
export function isStoreManaged(source: InstallationSource): boolean {
  return STORE_MANAGED_SOURCES.has(source)
}

/** Overall health of an installation, derived from its validation checks. */
export type InstallationStatus =
  /** Every check passed. Ready to play. */
  | 'ok'
  /** Playable, but something is off (missing mission packs, no write access, ...). */
  | 'warning'
  /** Root exists but this is not a usable Quake II installation. */
  | 'invalid'
  /** The root path is gone - unplugged drive, deleted folder, ... */
  | 'missing'
  /** Not checked yet (freshly loaded from disk). */
  | 'unknown'

export type CheckSeverity = 'ok' | 'info' | 'warn' | 'error'

export type ValidationCheckId =
  | 'root-exists'
  | 'base-game-dir'
  | 'base-paks'
  | 'executable'
  | 'executable-runnable'
  | 'engine-identified'
  | 'write-access'

/** A concrete action the UI can offer to resolve a failing check. */
export type ValidationFix =
  | 'locate-root'
  | 'select-executable'
  | 'set-write-dir'
  | 'revalidate'
  /** Parked: handled by the install/update module. */
  | 'install-game-files'
  /** Story 103 D3: the executable is a Windows PE off Windows - focuses the runner section (D7). */
  | 'choose-runner'

export interface ValidationCheck {
  id: ValidationCheckId
  severity: CheckSeverity
  /** i18n key, resolved in the renderer. */
  messageKey: string
  params?: Record<string, string | number>
  fix?: ValidationFix
}

/**
 * What a file's first bytes say it is: a Windows PE (`MZ`), a native ELF, a shebang script, or
 * anything else (including a file that could not be read). Produced by `readBinaryKind`
 * (`src/main/lib/fs-utils.ts`), which is where the bytes are actually looked at; the type lives
 * here because both `ValidationResult` and `Installation` carry it and the shared layer must not
 * depend on main.
 */
export type BinaryKind = 'pe' | 'elf' | 'script' | 'unknown'

export interface ValidationResult {
  status: InstallationStatus
  checks: ValidationCheck[]
  /** Game directories found next to `baseq2` (mods, mission packs). */
  gameDirs: string[]
  /** Client executables found in the root, in preference order. */
  executables: string[]
  engineKind: EngineKind
  detectedVersion?: string
  /**
   * Story 103 D2: the header kind of the executable this verdict settled on (the caller's own
   * `executablePath` when it still exists, otherwise the first of `executables`). Absent on
   * Windows - the header is never read there, where `.exe` is the whole question (AC8) - and
   * absent when no executable was found at all.
   */
  executableKind?: BinaryKind
  checkedAt: string
}

/**
 * An icon set on an installation (story 067). A shipped icon references a
 * basename in `src/renderer/src/assets/installations` by id; a custom icon
 * carries no path - the file lives at `userData/installation-icons/<id>.png`,
 * derived from the installation id, so no renderer-supplied path is ever
 * trusted or persisted.
 */
export type InstallationIcon = { kind: 'shipped'; id: string } | { kind: 'custom' }

/**
 * The last time this installation's setup/bootstrap failed (story 077). Kept deliberately
 * module-agnostic - `jobId` is a plain string, not a reference into the downloads module's job
 * types - so this file stays importable from both TS projects without pulling in a module that
 * has node/electron dependencies of its own. Cleared the moment a later verdict is playable (see
 * `InstallationsService`'s inspection-applying helper).
 */
export interface InstallationLastFailure {
  /** i18n key, resolved in the renderer. Never prose. */
  errorKey: string
  /** Epoch ms. */
  at: number
  /** The bootstrap job that failed. */
  jobId: string
  /**
   * Story 077 finding fix: the interpolation values `errorKey`'s sentence needs, when it is a
   * templated one - `downloads.error.packageIncomplete` reads `{{packageId}}`, and a card that
   * renders the key without them shows the raw `{{packageId}}` placeholder to the user. Data, never
   * prose (a manifest package id), exactly like `ValidationCheck.params` and the `Job.error.params`
   * the same failure exit already carries into the Downloads tab - so the two surfaces interpolate
   * the same sentence from the same values. Optional: most keys need none, and an installation
   * written before this field simply has none.
   */
  params?: Record<string, string | number>
}

export interface Installation {
  /** Stable id, generated once. Never derived from the path. */
  id: string
  /** User-facing name. Pre-filled on import, editable. */
  name: string
  /** Canonical absolute path to the installation root (the folder containing `baseq2`). */
  rootPath: string
  /**
   * Optional separate directory the engine may write to. Needed when the game
   * lives somewhere unwritable (Program Files) or when sharing one game folder
   * between several installations.
   */
  writeDirPath?: string
  engineKind: EngineKind
  /**
   * The engine this installation is actually known to be, set once when positively known
   * (bootstrap's user-chosen engine, an import/detection scan that identified one, or a completed
   * `reinstall-engine` repair) and never touched by revalidation. Deliberately separate from
   * `engineKind`, which a fresh inspection *does* overwrite on every `validate()`/`validateAll()`
   * call (see `InstallationsService.applyInspection`'s `preserveKnownEngine`) - `r1q2`/`q2pro` are
   * identified solely by their own executable, so once that executable goes missing `engineKind`
   * flips to `'unknown'` even though the installation is still, say, an r1q2 one underneath.
   * `repair/plan.ts`'s `reinstall-engine` offer reads this (falling back to `engineKind`) so it
   * keeps appearing across a restart. Absent on installations that predate this field or were never
   * bootstrapped/imported through a path that sets it.
   */
  recordedEngineKind?: EngineKind
  /** Absolute path of the client executable to launch. */
  executablePath?: string
  /**
   * Story 103 D2: what `executablePath` turned out to be by its header, recorded by the last
   * inspection that read one. Absent on Windows (no header is read there), on an installation that
   * predates this field, and on one that has no executable yet - so "absent" never means "not
   * native", only "not known".
   */
  executableKind?: BinaryKind
  /**
   * Story 103 D5: the runner the user picked for this installation - a `DetectedRunner.id`, or
   * `'native'`. Absent means "never chosen", which is not the same as `'native'`: an absent value
   * lets `resolveRunner` pick on its own (AC4's default cascade), and it is what every installation
   * predating this field has. A stored id whose runner is not installed on this machine right now
   * is kept as-is and simply falls back to the cascade until that runner reappears.
   */
  runner?: RunnerChoice
  /** Extra command line arguments, appended after the generated ones. */
  launchArgs: string[]
  /** `fs_game` / `game` value. Empty string means the base game. */
  activeGameDir: string
  detectedVersion?: string
  source: InstallationSource
  status: InstallationStatus
  checks: ValidationCheck[]
  gameDirs: string[]
  favorite: boolean
  /** Icon shown in the rail/header; absent means the default fallback icon. */
  icon?: InstallationIcon
  /** The most recent bootstrap failure, if the installation has one and no later verdict was playable. */
  lastFailure?: InstallationLastFailure
  /** Position in the installation rail. Lower comes first. */
  sortOrder: number
  createdAt: string
  updatedAt: string
  lastValidatedAt?: string
  lastPlayedAt?: string
  totalPlaytimeSeconds: number
  /**
   * Per-module scratch space, keyed by module id, so a future module can persist
   * its own data without changing this type or the schema version.
   */
  moduleData?: Record<string, unknown>
}

/** Payload for adding an installation that already exists on disk. */
export interface AddExistingInstallationInput {
  rootPath: string
  name?: string
  executablePath?: string
  source?: InstallationSource
}

/** Payload for the "create new installation" flow (download comes later). */
export interface CreateInstallationInput {
  rootPath: string
  name: string
  engineKind: EngineKind
}

/** The editable subset of an installation. */
export interface UpdateInstallationInput {
  id: string
  name?: string
  /**
   * Relocates an installation whose folder moved or came back on a different
   * drive letter. Identity (id, playtime, settings) is preserved.
   */
  rootPath?: string
  executablePath?: string
  writeDirPath?: string | null
  launchArgs?: string[]
  activeGameDir?: string
  favorite?: boolean
  /** Story 103 D6: sets the runner choice (`RunnerChoice`) `installations:listRunners` offers. */
  runner?: RunnerChoice
}

export interface RemoveInstallationInput {
  id: string
  /**
   * Story 094 D2: when true, `InstallationsService.remove()` deletes the installation's folder
   * from disk (via `deleteInstallationFolder`) before dropping the library entry, instead of only
   * dropping the entry. Refused - entry and files both left untouched - for a store-managed
   * installation (`isStoreManaged(source)`, `installations.error.deleteFromDiskStoreManaged`) and
   * while the installation's own game process is running
   * (`installations.error.deleteFromDiskRunning`); a failed/partial delete also leaves the entry
   * exactly as it was, since files are removed before the entry is (see `remove()`'s doc comment).
   */
  deleteFromDisk?: boolean
}

/** One candidate produced by a detection scan, before the user imports it. */
export interface DetectedInstallation {
  rootPath: string
  suggestedName: string
  engineKind: EngineKind
  executables: string[]
  source: InstallationSource
  gameDirs: string[]
  detectedVersion?: string
  /** True when an installation with this canonical root is already registered. */
  alreadyRegistered: boolean
}

export type DetectionPhase =
  'starting' | 'stores' | 'common-paths' | 'deep-scan' | 'done' | 'cancelled'

export interface DetectionProgress {
  scanId: string
  phase: DetectionPhase
  /** What is being looked at right now. Safe to show verbatim (a path). */
  currentPath?: string
  candidatesFound: number
  /** 0..1 where known, otherwise null for an indeterminate bar. */
  ratio: number | null
}

export interface DetectionResult {
  scanId: string
  candidates: DetectedInstallation[]
  cancelled: boolean
  durationMs: number
}

export interface ScanOptions {
  /**
   * Caller-generated id so the UI can cancel a scan without waiting for the
   * first progress event to learn the id.
   */
  scanId?: string
  /** Include the slow, user-triggered pass over whole drives. */
  deepScan?: boolean
  /** Drive roots for the deep scan, e.g. `['C:\\', 'D:\\']`. */
  drives?: string[]
}
