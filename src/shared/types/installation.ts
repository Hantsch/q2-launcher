import type { EngineKind } from './engine'

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

export type CheckSeverity = 'ok' | 'warn' | 'error'

export type ValidationCheckId =
  | 'root-exists'
  | 'base-game-dir'
  | 'base-paks'
  | 'executable'
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

export interface ValidationCheck {
  id: ValidationCheckId
  severity: CheckSeverity
  /** i18n key, resolved in the renderer. */
  messageKey: string
  params?: Record<string, string | number>
  fix?: ValidationFix
}

export interface ValidationResult {
  status: InstallationStatus
  checks: ValidationCheck[]
  /** Game directories found next to `baseq2` (mods, mission packs). */
  gameDirs: string[]
  /** Client executables found in the root, in preference order. */
  executables: string[]
  engineKind: EngineKind
  detectedVersion?: string
  checkedAt: string
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
  /** Absolute path of the client executable to launch. */
  executablePath?: string
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
}

export interface RemoveInstallationInput {
  id: string
  /**
   * Reserved for the install module. Step 1 always removes from the launcher only;
   * main rejects `true` so nothing can delete a user's game folder yet.
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
