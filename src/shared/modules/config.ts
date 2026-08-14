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
 */
export interface ConfigProfile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  cvars: Record<string, string>
  binds: Record<string, string>
  assignments: ProfileAssignment[]
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
