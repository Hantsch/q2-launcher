// Node side shared by the engine spikes' harnesses: finds the built engine, the game data and the
// demo, and starts the spike's Electron main with them in the environment.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT, resolveCacheDir } from '../../scripts/engine/data.mjs'

/** Exits 2 with `<prefix>: <message>`; every harness reports usage and setup errors this way. */
export function makeFail(prefix) {
  return (message) => {
    console.error(`${prefix}: ${message}`)
    process.exit(2)
  }
}

/** A retail install (Q2L_SPIKE_Q2DIR) wins over the shareware cache; nothing is downloaded. */
export function resolveEngineInputs(fail) {
  const engineDir = join(REPO_ROOT, 'resources', 'engine')
  for (const file of ['q2pro.js', 'q2pro.wasm']) {
    if (!existsSync(join(engineDir, file)))
      fail(`resources/engine/${file} is missing - run npm run engine:build`)
  }
  const retailDir = process.env.Q2L_SPIKE_Q2DIR ? resolve(process.env.Q2L_SPIKE_Q2DIR) : null
  let dataDir
  if (retailDir) {
    if (!existsSync(join(retailDir, 'baseq2', 'pak0.pak')))
      fail(`Q2L_SPIKE_Q2DIR=${retailDir} has no baseq2/pak0.pak`)
    dataDir = retailDir
  } else {
    const cacheDir = resolveCacheDir()
    if (!existsSync(join(cacheDir, 'baseq2', 'pak0.pak')))
      fail(`no Q2L_SPIKE_Q2DIR and no shareware cache at ${cacheDir} - run npm run engine:data`)
    dataDir = cacheDir
  }
  const paks = readdirSync(join(dataDir, 'baseq2'))
    .filter((name) => /^pak\d+\.pak$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((name) => join(dataDir, 'baseq2', name))
  return { engineDir, retailDir, dataDir, paks }
}

export function launchElectron(mainUrl, env, fail) {
  // Walks up to the repo's root node_modules; the spikes install no Electron of their own.
  const electronBinary = createRequire(import.meta.url)('electron')
  const main = fileURLToPath(mainUrl)
  const childEnv = { ...process.env, ...env }
  // An inherited ELECTRON_RUN_AS_NODE would make Electron run main as plain Node.
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electronBinary, [main], { stdio: 'inherit', env: childEnv })
  child.on('error', (e) => fail(`could not start electron: ${e.message}`))
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}
