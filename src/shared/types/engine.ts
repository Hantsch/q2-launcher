/**
 * The Quake II engines/clients the launcher knows about.
 *
 * `r1q2` is the primary target; the rest exist so that detection can *classify*
 * what it finds on disk instead of throwing it away, and so the later modules
 * (config, mods, assets) can branch on engine capabilities.
 */
export type EngineKind =
  | 'r1q2'
  | 'q2pro'
  | 'yquake2'
  | 'kmquake2'
  | 'vkquake2'
  | 'q2rtx'
  | 'vanilla'
  | 'remaster'
  | 'custom'
  | 'unknown'

/** Where an engine keeps the files it writes (configs, saves, screenshots). */
export type WriteDirStrategy =
  /** Classic behaviour: writes straight back into `<root>/baseq2`. */
  | 'install-dir'
  /** Writes into a per-user directory (e.g. `%APPDATA%` / `~/.yq2`). */
  | 'user-dir'
  | 'unknown'

export interface EngineDefinition {
  kind: EngineKind
  /** Short label for the UI. Not translated - these are product names. */
  label: string
  /**
   * Client executables, most specific first, matched case-insensitively against
   * the file names directly inside the installation root.
   */
  executables: string[]
  /** Dedicated-server binaries: recognised, but never auto-picked as the client to launch. */
  dedicatedExecutables: string[]
  /**
   * Files (relative to the installation root) whose presence is strong evidence
   * for this engine. Used to disambiguate engines that reuse `quake2.exe`.
   */
  markers: string[]
  /** Config files this engine reads/writes, for the future config module. */
  configFileCandidates: string[]
  /** Does it support classic mod loading via `+set game <dir>`? */
  supportsFsGame: boolean
  writeDirStrategy: WriteDirStrategy
  /**
   * Engine-specific switches the launcher always passes. Kept as data so a
   * wrong entry is a one-line fix rather than a change in the launch code.
   */
  defaultArgs: string[]
  homepage?: string
  /** Shown in the UI when an engine has caveats. i18n key. */
  noteKey?: string
}

/**
 * Detection table. Order matters: the first definition whose markers or
 * executables match wins, so specific engines must precede `vanilla`
 * (several source ports still ship a plain `quake2.exe`).
 *
 * NOTE: executable and marker names for engines other than r1q2/q2pro are
 * best-effort and deliberately data-driven - correcting an entry here is the
 * only change needed to fix classification. See docs/ROADMAP.md.
 */
export const ENGINE_DEFINITIONS: readonly EngineDefinition[] = [
  {
    kind: 'r1q2',
    label: 'R1Q2',
    executables: ['r1q2.exe', 'r1q2'],
    dedicatedExecutables: ['r1q2ded.exe', 'r1q2ded'],
    markers: ['r1q2.exe', 'r1q2ded.exe'],
    // There is no `r1q2.cfg`. r1q2 knows default.cfg (shipped inside pak0),
    // config.cfg (engine-written), autoexec.cfg (user) and postinit.cfg - an
    // r1q2 addition that runs after video/sound/input init.
    configFileCandidates: ['config.cfg', 'autoexec.cfg', 'postinit.cfg'],
    supportsFsGame: true,
    // r1q2 has no user directory of any kind: no homedir cvar, no -portable, no
    // Documents redirection. `config.cfg` is written to <install>/<gamedir>/,
    // so the install tree itself must be writable.
    writeDirStrategy: 'install-dir',
    defaultArgs: ['-nopathcheck'],
    homepage: 'https://www.r1ch.net/projects/r1q2',
    noteKey: 'engine.note.r1q2',
  },
  {
    kind: 'q2pro',
    label: 'Q2PRO',
    executables: ['q2pro.exe', 'q2pro'],
    dedicatedExecutables: ['q2proded.exe', 'q2proded'],
    markers: ['q2pro.exe'],
    configFileCandidates: ['q2pro.cfg', 'config.cfg'],
    supportsFsGame: true,
    // Q2PRO does have a `homedir` cvar, unlike r1q2.
    writeDirStrategy: 'user-dir',
    defaultArgs: [],
    homepage: 'https://github.com/skullernet/q2pro',
  },
  {
    kind: 'yquake2',
    label: 'Yamagi Quake II',
    executables: ['yquake2.exe', 'quake2.exe', 'quake2'],
    dedicatedExecutables: ['q2ded.exe', 'q2ded'],
    // yquake2 ships renderer libraries the original never had.
    markers: ['ref_gl3.dll', 'ref_gles3.dll', 'ref_gl1.dll', 'baseq2/game.dll'],
    configFileCandidates: ['yq2.cfg', 'config.cfg'],
    supportsFsGame: true,
    writeDirStrategy: 'user-dir',
    defaultArgs: [],
    homepage: 'https://www.yamagi.org/quake2/',
  },
  {
    kind: 'kmquake2',
    label: 'KMQuake II',
    executables: ['kmquake2.exe', 'kmquake2'],
    dedicatedExecutables: ['kmquake2ded.exe'],
    markers: ['kmquake2.exe'],
    configFileCandidates: ['kmq2config.cfg', 'config.cfg'],
    supportsFsGame: true,
    writeDirStrategy: 'install-dir',
    defaultArgs: [],
    homepage: 'https://www.markshan.com/knightmare/',
  },
  {
    kind: 'vkquake2',
    label: 'vkQuake2',
    executables: ['vkquake2.exe', 'quake2_vk.exe'],
    dedicatedExecutables: [],
    markers: ['vkquake2.exe', 'quake2_vk.exe'],
    configFileCandidates: ['config.cfg'],
    supportsFsGame: true,
    writeDirStrategy: 'install-dir',
    defaultArgs: [],
    homepage: 'https://github.com/kondrak/vkQuake2',
  },
  {
    kind: 'q2rtx',
    label: 'Quake II RTX',
    executables: ['q2rtx.exe', 'quake2rtx.exe'],
    dedicatedExecutables: ['q2rtxded.exe'],
    markers: ['q2rtx.exe', 'quake2rtx.exe'],
    configFileCandidates: ['q2rtx.cfg', 'config.cfg'],
    supportsFsGame: true,
    writeDirStrategy: 'install-dir',
    defaultArgs: [],
    homepage: 'https://github.com/NVIDIA/Q2RTX',
  },
  {
    kind: 'remaster',
    label: 'Quake II (2023 Remaster)',
    executables: ['quake2ex_steam.exe', 'quake2ex.exe', 'quake2ex_gog.exe'],
    dedicatedExecutables: [],
    // Deliberately NOT keyed on the `rerelease` directory: the Steam build of
    // Quake II ships the classic game in the install root *and* the remaster in
    // `rerelease/`, so a directory marker would misclassify a perfectly good
    // classic install as the remaster.
    markers: ['quake2ex_steam.exe', 'quake2ex.exe', 'quake2ex_gog.exe'],
    // Different engine, different game API, different config location
    // (%USERPROFILE%\Saved Games\Nightdive Studios\Quake II\).
    configFileCandidates: [],
    supportsFsGame: false,
    writeDirStrategy: 'user-dir',
    defaultArgs: [],
    noteKey: 'engine.note.remaster',
  },
  {
    kind: 'vanilla',
    label: 'Quake II (original)',
    executables: ['quake2.exe', 'quake2'],
    dedicatedExecutables: ['q2ded.exe'],
    markers: ['quake2.exe'],
    configFileCandidates: ['config.cfg'],
    supportsFsGame: true,
    writeDirStrategy: 'install-dir',
    defaultArgs: [],
  },
]

export function getEngineDefinition(kind: EngineKind): EngineDefinition | undefined {
  return ENGINE_DEFINITIONS.find((e) => e.kind === kind)
}

export function engineLabel(kind: EngineKind): string {
  if (kind === 'custom') return 'Custom'
  if (kind === 'unknown') return 'Unknown engine'
  return getEngineDefinition(kind)?.label ?? kind
}
