// Spike (throwaway): runs the matrix on Linux inside a node:22-bookworm container under
// Xvfb and copies results/ back. Run: node run-linux.mjs  (exits non-zero if Docker is missing or
// the harness fails). The apt layer is a cached image and npm/electron downloads live in named
// volumes, so a rerun skips the slow steps. (story 282)

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPIKE_DIR = fileURLToPath(new URL('.', import.meta.url))
const IMAGE = 'q282-linux-base:1'
const STEP_TIMEOUT_MS = 9 * 60_000

const run = (args, opts = {}) =>
  spawnSync('docker', args, { stdio: 'inherit', timeout: STEP_TIMEOUT_MS, ...opts })

if (spawnSync('docker', ['version', '--format', '{{.Server.Version}}']).status !== 0) {
  console.error('docker is not available (or its daemon is not running)')
  process.exit(1)
}

// The container installs the same Electron the repo ships, so the Linux and win32 rows compare.
const electronPkg = createRequire(import.meta.url).resolve('electron/package.json')
const electronVersion = JSON.parse(readFileSync(electronPkg, 'utf8')).version
console.log(`electron ${electronVersion} (from ${dirname(electronPkg)})`)

if (spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status !== 0) {
  const dockerfile = `FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth \
    libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0 libdrm2 \
    libx11-xcb1 libxcb-dri3-0 libxkbcommon0 libcups2 libpango-1.0-0 libcairo2 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libatspi2.0-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
`
  const build = run(['build', '-t', IMAGE, '-'], {
    input: dockerfile,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  if (build.status !== 0) {
    console.error('image build failed')
    process.exit(1)
  }
}

mkdirSync(join(SPIKE_DIR, 'results'), { recursive: true })

// Copies the spike without node_modules/results (Windows binaries, host output); SPIKE282_ELECTRON_ARGS
// carries the container-only switches (see harness.mjs).
const script = `set -e
mkdir /work
cd /src && tar cf - --exclude=./node_modules --exclude=./results . | tar xf - -C /work
cd /work
npm install --no-audit --no-fund
npm install --no-save --no-audit --no-fund electron@${electronVersion}
mkdir -p results
set +e
SPIKE282_ELECTRON_ARGS="--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist" xvfb-run -a -s "-screen 0 1920x1080x24" node harness.mjs --platform-label=linux
code=$?
set -e
cp -r results/. /out/
[ "$code" -ne 0 ] || node verify-sample.mjs /out/sample-linux.mp4
exit $code
`

const result = run([
  'run',
  '--rm',
  '--shm-size=2g',
  '-v',
  `${SPIKE_DIR}:/src:ro`,
  '-v',
  `${join(SPIKE_DIR, 'results')}:/out`,
  '-v',
  'q282-npm-cache:/root/.npm',
  '-v',
  'q282-electron-cache:/root/.cache/electron',
  IMAGE,
  'bash',
  '-c',
  script,
])
if (result.status !== 0) {
  console.error(`linux run failed (status ${result.status})`)
  process.exit(1)
}
if (!existsSync(join(SPIKE_DIR, 'results', 'matrix-linux.json'))) {
  console.error('results/matrix-linux.json was not written')
  process.exit(1)
}
console.log('linux run ok')
