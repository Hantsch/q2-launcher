// Spike (throwaway, not imported by src/): steps the WebAssembly engine by host-given milliseconds
// in an Electron window and checks that repeated runs render byte-identical frames. Origin:
// spikes/284-demo-frame-in-electron/harness.mjs. Run: node spikes/285-deterministic-step/harness.mjs
// [--runs=N] [--seed=N | --no-seed] [--renderer=swiftshader|gpu] [--fps=30|60] [--steps=N]

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT, resolveCacheDir } from '../../scripts/engine/data.mjs'

function fail(message) {
  console.error(`spike 285: ${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const out = { runs: 2, seed: 1, renderer: 'swiftshader', fps: 30, steps: 300 }
  const int = (name, text, min) => {
    const n = Number(text)
    if (!Number.isInteger(n) || n < min) fail(`--${name} must be an integer >= ${min}`)
    return n
  }
  for (const arg of argv) {
    const [key, value] = arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s) : [arg]
    if (key === 'no-seed' && value === undefined) out.seed = null
    else if (value === undefined) fail(`unknown argument ${arg}`)
    else if (key === 'runs') out.runs = int(key, value, 1)
    else if (key === 'seed') out.seed = int(key, value, 0)
    else if (key === 'steps') out.steps = int(key, value, 1)
    else if (key === 'fps') {
      if (value !== '30' && value !== '60') fail('--fps must be 30 or 60')
      out.fps = Number(value)
    } else if (key === 'renderer') {
      if (value !== 'swiftshader' && value !== 'gpu') fail('--renderer must be swiftshader or gpu')
      out.renderer = value
    } else fail(`unknown argument ${arg}`)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

const engineDir = join(REPO_ROOT, 'resources', 'engine')
for (const file of ['q2pro.js', 'q2pro.wasm']) {
  if (!existsSync(join(engineDir, file)))
    fail(`resources/engine/${file} is missing - run npm run engine:build`)
}

// A retail install wins over the shareware cache; the spike never downloads anything.
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

const demoPath = join(REPO_ROOT, 'tests', 'engine', 'demos', 'move-fire.dm2')
if (!existsSync(demoPath)) fail(`demo not found: ${demoPath}`)

const paks = readdirSync(join(dataDir, 'baseq2'))
  .filter((name) => /^pak\d+\.pak$/i.test(name))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .map((name) => join(dataDir, 'baseq2', name))

// Walks up to the repo's root node_modules; the spike installs no Electron of its own.
const electronBinary = createRequire(import.meta.url)('electron')
const main = fileURLToPath(new URL('./main.cjs', import.meta.url))

// An inherited ELECTRON_RUN_AS_NODE would make Electron run main.cjs as plain Node.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
Object.assign(env, {
  Q2L_SPIKE_ENGINE_DIR: engineDir,
  Q2L_SPIKE_PAKS: JSON.stringify(paks),
  Q2L_SPIKE_DEMO: demoPath,
  Q2L_SPIKE_RENDERER: args.renderer,
  Q2L_SPIKE_SEED: args.seed === null ? '' : String(args.seed),
  Q2L_SPIKE_RUNS: String(args.runs),
  Q2L_SPIKE_FPS: String(args.fps),
  Q2L_SPIKE_STEPS: String(args.steps),
})

console.log(
  `spike 285: renderer=${args.renderer} runs=${args.runs} seed=${args.seed ?? 'none'} fps=${args.fps} steps=${args.steps} data=${dataDir}`,
)
const child = spawn(electronBinary, [main], { stdio: 'inherit', env })
child.on('error', (e) => fail(`could not start electron: ${e.message}`))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
