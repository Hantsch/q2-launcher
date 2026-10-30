// Spike (throwaway, not imported by src/): steps the WebAssembly engine by host-given milliseconds
// in an Electron window and checks that repeated runs render byte-identical frames. Origin:
// spikes/284-demo-frame-in-electron/harness.mjs. Run: node spikes/285-deterministic-step/harness.mjs
// [--runs=N] [--seed=N | --no-seed] [--renderer=swiftshader|gpu] [--fps=30|60] [--steps=N]

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../scripts/engine/data.mjs'
import { launchElectron, makeFail, resolveEngineInputs } from '../lib/engine-launch.mjs'

const fail = makeFail('spike 285')

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

const { engineDir, dataDir, paks } = resolveEngineInputs(fail)

const demoPath = join(REPO_ROOT, 'tests', 'engine', 'demos', 'move-fire.dm2')
if (!existsSync(demoPath)) fail(`demo not found: ${demoPath}`)

const env = {
  Q2L_SPIKE_ENGINE_DIR: engineDir,
  Q2L_SPIKE_PAKS: JSON.stringify(paks),
  Q2L_SPIKE_DEMO: demoPath,
  Q2L_SPIKE_RENDERER: args.renderer,
  Q2L_SPIKE_SEED: args.seed === null ? '' : String(args.seed),
  Q2L_SPIKE_RUNS: String(args.runs),
  Q2L_SPIKE_FPS: String(args.fps),
  Q2L_SPIKE_STEPS: String(args.steps),
}

console.log(
  `spike 285: renderer=${args.renderer} runs=${args.runs} seed=${args.seed ?? 'none'} fps=${args.fps} steps=${args.steps} data=${dataDir}`,
)
launchElectron(new URL('./main.mjs', import.meta.url), env, fail)
