// Spike (throwaway, not imported by src/): boots the WebAssembly engine in an Electron window with
// the launcher's security settings, plays a demo and measures it. Run: npm run engine:smoke
// [-- --no-wasm-csp] [--pad-mb <n>] [--demo <relpath>] [--label <name>] [--seconds <n>]   (story 284)

import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { REPO_ROOT } from '../../scripts/engine/data.mjs'
import { launchElectron, makeFail, resolveEngineInputs } from '../lib/engine-launch.mjs'

const fail = makeFail('engine:smoke')

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

const { engineDir, retailDir, dataDir, paks } = resolveEngineInputs(fail)

const DEFAULT_DEMO = join(REPO_ROOT, 'tests', 'engine', 'demos', 'move-fire.dm2')
const demoPath = args.demo ? resolve(retailDir ?? REPO_ROOT, args.demo) : DEFAULT_DEMO
if (!existsSync(demoPath)) fail(`demo not found: ${demoPath}`)
if (!demoPath.toLowerCase().endsWith('.dm2')) fail(`demo must be a .dm2 file: ${demoPath}`)

const label = args.label ?? (retailDir ? 'retail' : 'shareware')

const env = {
  Q2L_SPIKE_ENGINE_DIR: engineDir,
  Q2L_SPIKE_PAKS: JSON.stringify(paks),
  Q2L_SPIKE_DEMO: demoPath,
  Q2L_SPIKE_LABEL: label,
  Q2L_SPIKE_PAD_MB: String(args.padMb),
  Q2L_SPIKE_SECONDS: String(args.seconds),
  Q2L_SPIKE_WASM_CSP: args.wasmCsp ? '1' : '0',
}

console.log(
  `engine:smoke: label=${label} data=${dataDir} demo=${basename(demoPath)} csp=${args.wasmCsp ? 'wasm-unsafe-eval' : 'no-wasm'}`,
)
launchElectron(new URL('./main.mjs', import.meta.url), env, fail)
