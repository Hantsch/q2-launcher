// Spike (throwaway, not imported by src/): pulls the audio the engine's web sound driver mixes
// while the engine is stepped, counts frames per step and hashes the PCM. Run:
// node spikes/286-dma-audio-pull/harness.mjs --mode=capture [--frames=N] [--fps=30|60] [--runs=N]
// [--seed=N]  |  --mode=realtime [--seconds=N] [--transport=port|sab]   (story 286)

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../scripts/engine/data.mjs'
import { launchElectron, makeFail, resolveEngineInputs } from '../lib/engine-launch.mjs'

const fail = makeFail('spike 286')

function parseArgs(argv) {
  const out = { mode: null, frames: 600, fps: 60, runs: 1, seed: 1, seconds: 60, transport: 'port' }
  const int = (name, text, min) => {
    const n = Number(text)
    if (!Number.isInteger(n) || n < min) fail(`--${name} must be an integer >= ${min}`)
    return n
  }
  for (const arg of argv) {
    const [key, value] = arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s) : [arg]
    if (value === undefined) fail(`unknown argument ${arg}`)
    else if (key === 'mode') {
      if (value !== 'capture' && value !== 'realtime') fail('--mode must be capture or realtime')
      out.mode = value
    } else if (key === 'frames') out.frames = int(key, value, 1)
    else if (key === 'seconds') out.seconds = int(key, value, 1)
    else if (key === 'transport') {
      if (value !== 'port' && value !== 'sab') fail('--transport must be port or sab')
      out.transport = value
    } else if (key === 'runs') out.runs = int(key, value, 1)
    else if (key === 'seed') out.seed = int(key, value, 0)
    else if (key === 'fps') {
      if (value !== '30' && value !== '60') fail('--fps must be 30 or 60')
      out.fps = Number(value)
    } else fail(`unknown argument ${arg}`)
  }
  if (out.mode === null) fail('--mode=capture is required')
  return out
}

const args = parseArgs(process.argv.slice(2))
const { engineDir, dataDir, paks } = resolveEngineInputs(fail)
const demoPath = join(REPO_ROOT, 'tests', 'engine', 'demos', 'move-fire.dm2')
if (!existsSync(demoPath)) fail(`demo not found: ${demoPath}`)

console.log(
  `spike 286: mode=${args.mode} frames=${args.frames} fps=${args.fps} runs=${args.runs} seed=${args.seed} data=${dataDir}`,
)
launchElectron(
  new URL('./main.mjs', import.meta.url),
  {
    Q2L_SPIKE_ENGINE_DIR: engineDir,
    Q2L_SPIKE_PAKS: JSON.stringify(paks),
    Q2L_SPIKE_DEMO: demoPath,
    Q2L_SPIKE_SEED: String(args.seed),
    Q2L_SPIKE_RUNS: String(args.runs),
    Q2L_SPIKE_FPS: String(args.fps),
    Q2L_SPIKE_FRAMES: String(args.frames),
    Q2L_SPIKE_MODE: args.mode,
    Q2L_SPIKE_SECONDS: String(args.seconds),
    Q2L_SPIKE_TRANSPORT: args.transport,
  },
  fail,
)
