// Spike (throwaway, not imported by src/): runs the WebCodecs encoder matrix inside the repo's
// Electron. Run: node harness.mjs [--platform-label=<label>]  (label defaults to process.platform)
// (story 282)

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const labelArg = process.argv.slice(2).find((a) => a.startsWith('--platform-label='))
const label = labelArg ? labelArg.slice('--platform-label='.length) : process.platform
if (!/^[\w.-]+$/.test(label)) {
  console.error(`invalid --platform-label: ${label}`)
  process.exit(2)
}

// Walks up to the repo's root node_modules; the spike installs no Electron of its own.
const electronBinary = createRequire(import.meta.url)('electron')
const main = fileURLToPath(new URL('./main.mjs', import.meta.url))

// An inherited ELECTRON_RUN_AS_NODE would make Electron run main.mjs as plain Node.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
// Extra Electron switches from run-linux.mjs only: the container needs --no-sandbox (Chromium refuses
// to run as root) and software WebGL (no GPU, so WebGL2 is blocklisted). Switches must be on the
// command line, which Chromium reads before any JS runs.
const extraArgs = (process.env.SPIKE282_ELECTRON_ARGS ?? '').split(' ').filter(Boolean)
const child = spawn(electronBinary, [...extraArgs, main, `--platform-label=${label}`], {
  stdio: 'inherit',
  env,
})
child.on('error', (e) => {
  console.error(`could not start electron: ${e.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
