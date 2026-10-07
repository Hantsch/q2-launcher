/**
 * Demo play eligibility - pure. Decides whether a listed demo can be played in Q2PRO right now
 * (`+demo <file>` on the active installation) and, if not, which single reason to show as an i18n
 * key (never prose). Checks run in a fixed order so the first violated rule is the one reported.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC,
 * no electron.
 */

import type { DiscoveredDemo } from '../modules/replays'
import { refuse, type DomainResult, type Refusal } from '../types/common'
import type { Installation } from '../types/installation'
import { STEAM_RUNNER_CHOICE } from '../types/runner'

export const DEMO_BASE_GAME_DIR = 'baseq2'

export type DemoPlayReasonKey =
  | 'replays.play.unavailable.linuxNoQ2pro'
  | 'replays.play.unavailable.modMissing'
  | 'replays.play.unavailable.notQ2pro'
  | 'replays.play.unavailable.needsDirectLaunch'
  | 'replays.play.unavailable.gameRunning'
  | 'replays.play.unavailable.unsafeName'

/** `acknowledgeable` marks a warning, not a blocker: playing is allowed once the user has acknowledged it (`acknowledgeModMissing`). */
export type DemoPlayRefusal = Refusal<DemoPlayReasonKey> & { acknowledgeable?: true }

export type DemoPlayEligibility =
  | Exclude<
      DomainResult<
        {
          installationId: string
          gameDir: string
          /** True when the demo may be played by its own name from the installation (`extraArgs`); else a copy is staged. */
          inPlace: boolean
          extraArgs: string[]
          /** Set when the installation's own engine is not Q2PRO: the launch must use its detected Q2PRO. */
          engine?: 'q2pro'
        },
        DemoPlayReasonKey
      >,
      Refusal
    >
  | DemoPlayRefusal

export interface DemoPlayInput {
  demo: DiscoveredDemo
  installations: readonly Pick<
    Installation,
    'id' | 'engineKind' | 'detectedEngines' | 'gameDirs' | 'runner'
  >[]
  activeInstallationId: string | null
  platform: string
  gameRunning: boolean
  /** The user has seen the "mod not fully installed" warning and plays anyway. */
  acknowledgeModMissing?: boolean
}

const SAFE_FILE_NAME = /^[A-Za-z0-9_.-]+$/

function asciiLower(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]
  }
  return out
}

function sameDir(a: string, b: string): boolean {
  return asciiLower(a) === asciiLower(b)
}

/**
 * The game dir (mod) a demo was recorded in: its header's game dir (`baseq2` when the header names
 * none), or - when the header could not be read - the dir of the folder it was found in.
 */
export function demoGameDir(demo: DiscoveredDemo): string {
  if (!demo.readable) {
    return demo.source.kind === 'installation' ? demo.source.gameDir : DEMO_BASE_GAME_DIR
  }
  return demo.gameDir === null || demo.gameDir === '' ? DEMO_BASE_GAME_DIR : demo.gameDir
}

function isQ2proCapable(i: Pick<Installation, 'engineKind' | 'detectedEngines'>): boolean {
  return (
    i.engineKind === 'q2pro' ||
    (i.detectedEngines ?? []).some((e) => e.kind === 'q2pro' && e.supported)
  )
}

function hasGameDir(gameDirs: readonly string[], dir: string): boolean {
  return sameDir(dir, DEMO_BASE_GAME_DIR) || gameDirs.some((d) => sameDir(d, dir))
}

export function demoPlayEligibility(input: DemoPlayInput): DemoPlayEligibility {
  const { demo, installations, activeInstallationId, platform, gameRunning } = input
  const gameDir = demoGameDir(demo)

  if (platform === 'linux' && !installations.some(isQ2proCapable)) {
    return refuse('replays.play.unavailable.linuxNoQ2pro')
  }

  const active =
    activeInstallationId === null
      ? undefined
      : installations.find((i) => i.id === activeInstallationId)
  if (!active || !isQ2proCapable(active)) return refuse('replays.play.unavailable.notQ2pro')
  if (active.runner === STEAM_RUNNER_CHOICE)
    return refuse('replays.play.unavailable.needsDirectLaunch')
  if (gameRunning) return refuse('replays.play.unavailable.gameRunning')
  // Last, and only a warning: a mod folder the inspector does not list (only demos, or files the
  // server sent on connect) still plays - the user decides. Last so the warning is never shown for
  // a demo that could not be played anyway.
  if (!hasGameDir(active.gameDirs, gameDir) && !input.acknowledgeModMissing) {
    return {
      ...refuse('replays.play.unavailable.modMissing', { gameDir }),
      acknowledgeable: true,
    }
  }

  // Story 160: a demo from elsewhere is playable through a temporary copy, so location never
  // refuses. Only a demo that sits in the active installation, with a name the console can take, is
  // a candidate for in-place play (main still verifies containment itself); anything else is copied
  // and the copy is named by demo id, so the original name is irrelevant there.
  const { source } = demo
  const inPlace =
    source.kind === 'installation' &&
    source.installationId === active.id &&
    demo.archiveEntry === null &&
    (sameDir(source.gameDir, gameDir) || sameDir(source.gameDir, DEMO_BASE_GAME_DIR)) &&
    SAFE_FILE_NAME.test(demo.fileName)

  return {
    ok: true,
    installationId: active.id,
    gameDir,
    inPlace,
    extraArgs: inPlace ? ['+demo', demo.fileName] : [],
    ...(active.engineKind !== 'q2pro' ? { engine: 'q2pro' as const } : {}),
  }
}
