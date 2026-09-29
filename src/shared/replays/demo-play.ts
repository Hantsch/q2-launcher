/**
 * Demo play eligibility - pure. Decides whether a listed demo can be played in Q2PRO right now
 * (`+demo <file>` on the active installation) and, if not, which single reason to show as an i18n
 * key (never prose). Checks run in a fixed order so the first violated rule is the one reported.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC,
 * no electron.
 */

import type { DiscoveredDemo } from '../modules/replays'
import type { Installation } from '../types/installation'
import { STEAM_RUNNER_CHOICE } from '../types/runner'

export const DEMO_BASE_GAME_DIR = 'baseq2'

export type DemoPlayReasonKey =
  | 'replays.play.unavailable.linuxNoQ2pro'
  | 'replays.play.unavailable.modMissing'
  | 'replays.play.unavailable.notQ2pro'
  | 'replays.play.unavailable.needsDirectLaunch'
  | 'replays.play.unavailable.gameRunning'
  | 'replays.play.unavailable.notInInstallation'
  | 'replays.play.unavailable.unsafeName'

export interface DemoPlayReason {
  key: DemoPlayReasonKey
  params?: Record<string, string | number>
}

export type DemoPlayEligibility =
  | { ok: true; installationId: string; gameDir: string; extraArgs: string[] }
  | { ok: false; reason: DemoPlayReason }

export interface DemoPlayInput {
  demo: DiscoveredDemo
  installations: readonly Pick<Installation, 'id' | 'engineKind' | 'gameDirs' | 'runner'>[]
  activeInstallationId: string | null
  platform: string
  gameRunning: boolean
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

function hasGameDir(gameDirs: readonly string[], dir: string): boolean {
  return sameDir(dir, DEMO_BASE_GAME_DIR) || gameDirs.some((d) => sameDir(d, dir))
}

function refuse(key: DemoPlayReasonKey, params?: Record<string, string | number>): DemoPlayEligibility {
  return params === undefined ? { ok: false, reason: { key } } : { ok: false, reason: { key, params } }
}

export function demoPlayEligibility(input: DemoPlayInput): DemoPlayEligibility {
  const { demo, installations, activeInstallationId, platform, gameRunning } = input
  const gameDir = demoGameDir(demo)

  if (platform === 'linux' && !installations.some((i) => i.engineKind === 'q2pro')) {
    return refuse('replays.play.unavailable.linuxNoQ2pro')
  }
  if (!installations.some((i) => hasGameDir(i.gameDirs, gameDir))) {
    return refuse('replays.play.unavailable.modMissing', { gameDir })
  }

  const active = activeInstallationId === null ? undefined : installations.find((i) => i.id === activeInstallationId)
  if (!active || active.engineKind !== 'q2pro') return refuse('replays.play.unavailable.notQ2pro')
  if (!hasGameDir(active.gameDirs, gameDir)) return refuse('replays.play.unavailable.modMissing', { gameDir })
  if (active.runner === STEAM_RUNNER_CHOICE) return refuse('replays.play.unavailable.needsDirectLaunch')
  if (gameRunning) return refuse('replays.play.unavailable.gameRunning')

  const { source } = demo
  if (
    source.kind !== 'installation' ||
    source.installationId !== active.id ||
    demo.archiveEntry !== null ||
    !(sameDir(source.gameDir, gameDir) || sameDir(source.gameDir, DEMO_BASE_GAME_DIR))
  ) {
    return refuse('replays.play.unavailable.notInInstallation')
  }
  if (!SAFE_FILE_NAME.test(demo.fileName)) return refuse('replays.play.unavailable.unsafeName')

  return { ok: true, installationId: active.id, gameDir, extraArgs: ['+demo', demo.fileName] }
}
