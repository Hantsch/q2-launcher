/**
 * Story 103 D4. What can execute a game's binary off Windows: the OS itself (`native`), or one of
 * the Windows-compatibility layers a Linux host may have installed - plain Wine, Steam's `umu-run`
 * launcher script, or a Proton build under a Steam library. D5 decides which of these applies to a
 * given executable; this file only names the possibilities.
 */
export type RunnerKind = 'native' | 'wine' | 'umu' | 'proton'

/**
 * One runner `detectRunners()` (`src/main/services/runners.ts`) found - or looked for and did not
 * find - on the host. `id` is stable and distinguishes multiple runners of the same `kind` (several
 * Proton builds can be installed side by side); for `native`, `wine` and `umu`, at most one runner
 * of that kind ever exists, so `id` just equals `kind`.
 */
/**
 * Story 103 D5: what an installation stores as its runner choice - a `DetectedRunner.id` (`wine`,
 * `umu`, a Proton slug), or `'native'` for "run the executable directly". A plain string rather
 * than a closed union because the Proton ids are derived from folder names at detection time, and
 * a stored id whose runner is not installed right now must still round-trip through `state.json`
 * unchanged; `resolveRunner` (`src/main/services/runners.ts`) is what decides whether a stored
 * choice is usable, never the type.
 */
export type RunnerChoice = string

/** The `RunnerChoice` meaning "no wrapper - run the executable itself", i.e. `NATIVE_RUNNER.id`. */
export const NATIVE_RUNNER_CHOICE = 'native'

export interface DetectedRunner {
  kind: RunnerKind
  /** Stable identifier, e.g. `wine`, `umu`, or a slug derived from a Proton folder name. */
  id: string
  /** Human-readable label (a Proton build's folder name); absent when the kind's name says it all. */
  label?: string
  /** Absolute path to the runner - its executable for wine/umu, its install folder for Proton. */
  path: string
  /** Whether this runner was actually found on the host. */
  available: boolean
}
