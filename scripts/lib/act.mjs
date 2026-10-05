// act and Docker probes shared by the scripts that run GitHub workflows locally through act
// (verify-release.mjs, rehearse.mjs).
//
// Every spawn here hides its window: rehearse.mjs calls these from a detached runner that has no
// console, where each console child would otherwise open a window of its own.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.mjs'

const IS_WIN = process.platform === 'win32'

/** Runs a command and returns its trimmed stdout, or `null` if it failed. */
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf-8', windowsHide: true })
  return result.status === 0 ? result.stdout.trim() : null
}

/**
 * `ACT`, else `act` on the PATH, else (Windows) winget's install folder - winget only puts act on
 * the PATH of shells started after the install, which agent and IDE shells often are not.
 */
export function resolveAct() {
  if (process.env.ACT) return process.env.ACT
  if (capture('act', ['--version']) !== null) return 'act'
  if (IS_WIN && process.env.LOCALAPPDATA) {
    const packages = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
    const dir = existsSync(packages)
      ? readdirSync(packages).find((name) => name.startsWith('nektos.act_'))
      : undefined
    if (dir && existsSync(join(packages, dir, 'act.exe'))) return join(packages, dir, 'act.exe')
  }
  return null
}

/** True when the Docker daemon answers - act needs it for every job. */
export function dockerRunning() {
  return capture('docker', ['info', '--format', '{{.ServerVersion}}']) !== null
}

/** Removes act job containers left behind by an aborted run - they break the next one. */
export function removeStaleActContainers() {
  const ids = capture('docker', ['ps', '-aq', '--filter', 'name=act-'])
  if (!ids) return
  const result = spawnSync('docker', ['rm', '-f', ...ids.split(/\s+/)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) console.error(`could not start docker: ${result.error.message}`)
}
