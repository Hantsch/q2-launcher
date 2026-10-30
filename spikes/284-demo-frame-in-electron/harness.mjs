// Spike (throwaway, not imported by src/): boots the WebAssembly engine in an Electron window with
// the launcher's security settings, plays a demo and measures it. Run: npm run engine:smoke
// [-- --no-wasm-csp] [--pad-mb <n>] [--demo <relpath>] [--label <name>] [--seconds <n>]   (story 284)

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT, resolveCacheDir } from '../../scripts/engine/data.mjs'

function fail(message) {
  console.error(`engine:smoke: ${message}`)
  process.exit(2)
}

function parseArgs(argv) {
  const out = { wasmCsp: true, demo: null, label: null, seconds: 10, padMb: 0 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${arg} needs a value`)
      return v
    }
    if (arg === '--no-wasm-csp') out.wasmCsp = false
    else if (arg === '--demo') out.demo = value()
    else if (arg === '--label') out.label = value()
    else if (arg === '--pad-mb') out.padMb = Number(value())
    else if (arg === '--seconds') out.seconds = Number(value())
    else fail(`unknown argument ${arg}`)
  }
  if (!Number.isFinite(out.seconds) || out.seconds <= 0) fail('--seconds must be a positive number')
  if (!Number.isFinite(out.padMb) || out.padMb < 0) fail('--pad-mb must be a number >= 0')
  if (out.label !== null && !/^[\w.-]+$/.test(out.label)) fail(`invalid --label: ${out.label}`)
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

const DEFAULT_DEMO = join(REPO_ROOT, 'tests', 'engine', 'demos', 'move-fire.dm2')
const demoPath = args.demo ? resolve(retailDir ?? REPO_ROOT, args.demo) : DEFAULT_DEMO
if (!existsSync(demoPath)) fail(`demo not found: ${demoPath}`)
if (!demoPath.toLowerCase().endsWith('.dm2')) fail(`demo must be a .dm2 file: ${demoPath}`)

const paks = readdirSync(join(dataDir, 'baseq2'))
  .filter((name) => /^pak\d+\.pak$/i.test(name))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .map((name) => join(dataDir, 'baseq2', name))

const label = args.label ?? (retailDir ? 'retail' : 'shareware')

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
  Q2L_SPIKE_LABEL: label,
  Q2L_SPIKE_PAD_MB: String(args.padMb),
  Q2L_SPIKE_SECONDS: String(args.seconds),
  Q2L_SPIKE_WASM_CSP: args.wasmCsp ? '1' : '0',
})

console.log(
  `engine:smoke: label=${label} data=${dataDir} demo=${basename(demoPath)} csp=${args.wasmCsp ? 'wasm-unsafe-eval' : 'no-wasm'}`,
)
const child = spawn(electronBinary, [main], { stdio: 'inherit', env })
child.on('error', (e) => fail(`could not start electron: ${e.message}`))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
