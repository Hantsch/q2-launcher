// `npm run engine:build [-- --opt=O0|O1|O2 --check-config --patches-dir=<dir>]`: builds the pinned
// Q2PRO upstream (engine/UPSTREAM + engine/patches) as WebAssembly inside a pinned Docker image
// and copies q2pro.js / q2pro.wasm to resources/engine/. (story 281)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configReport, orderPatches, parseArgs, readUpstream } from './lib.mjs'

export const fwd = (p) => p.split(String.fromCharCode(92)).join('/')
export const trimSlash = (p) =>
  p.endsWith('/') || p.endsWith(String.fromCharCode(92)) ? p.slice(0, -1) : p
const ROOT = trimSlash(fileURLToPath(new URL('../..', import.meta.url)))

// The image is keyed on the Dockerfile, so a toolchain change rebuilds it and nothing else does.
export const engineImageTag = (root) =>
  `q2launcher-engine:${createHash('sha256')
    .update(readFileSync(join(root, 'engine/docker/Dockerfile')))
    .digest('hex')
    .slice(0, 12)}`

function docker(args, opts = {}) {
  // MSYS_NO_PATHCONV stops Git Bash from rewriting the /engine-* container paths.
  return spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    ...opts,
  })
}

export function runEngineBuild(argv) {
  const args = parseArgs(argv)
  const started = Date.now()
  if (docker(['--version']).error)
    throw new Error('docker not found on PATH; install Docker to build the engine')

  const { repo, commit } = readUpstream(readFileSync(join(ROOT, 'engine/UPSTREAM'), 'utf8'))
  const patchesDir = resolve(ROOT, args.patchesDir ?? 'engine/patches')
  const patchOrder = orderPatches(
    existsSync(patchesDir) ? readdirSync(patchesDir).filter((f) => f.endsWith('.patch')) : [],
  )

  const dockerDir = join(ROOT, 'engine/docker')
  const tag = engineImageTag(ROOT)
  const built = docker(['build', '-t', tag, fwd(dockerDir)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (built.status !== 0) throw new Error('docker build failed')

  const work = join(ROOT, '.engine-build')
  rmSync(join(work, 'out'), { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const run = docker(
    [
      'run',
      '--rm',
      '-v',
      `${fwd(work)}:/engine-build`,
      '-v',
      `${fwd(patchesDir)}:/engine-patches:ro`,
      '-v',
      `${fwd(join(ROOT, 'engine/cross'))}:/engine/cross:ro`,
      '-v',
      `${fwd(join(dockerDir, 'build.sh'))}:/engine/build.sh:ro`,
      '-e',
      `REPO=${repo}`,
      '-e',
      `COMMIT=${commit}`,
      '-e',
      `PATCH_ORDER=${patchOrder.join(String.fromCharCode(10))}`,
      tag,
      'bash',
      '/engine/build.sh',
      args.opt,
      ...(args.checkConfig ? ['--check-config'] : []),
    ],
    { stdio: args.checkConfig ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'] },
  )
  if (run.status !== 0 && run.stdout) process.stdout.write(run.stdout)
  if (run.status !== 0) throw new Error(`engine build failed (exit ${run.status})`)

  if (args.checkConfig) {
    const section = (name, next) => {
      const from = run.stdout.indexOf(`@@${name}@@`)
      const to = next ? run.stdout.indexOf(`@@${next}@@`) : run.stdout.length
      return JSON.parse(run.stdout.slice(from + name.length + 4, to))
    }
    const lines = configReport(section('BUILDOPTIONS', 'TARGETS'), section('TARGETS'))
    console.log(lines.join('\n'))
    return { lines }
  }

  const dest = join(ROOT, 'resources/engine')
  mkdirSync(dest, { recursive: true })
  for (const f of ['q2pro.js', 'q2pro.wasm']) copyFileSync(join(work, 'out', f), join(dest, f))
  const wasmBytes = statSync(join(dest, 'q2pro.wasm')).size
  const elapsed = ((Date.now() - started) / 1000).toFixed(0)
  console.log(`wasm bytes: ${wasmBytes}\nelapsed: ${elapsed}s`)
  return { wasmBytes, elapsed: Number(elapsed) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runEngineBuild(process.argv.slice(2))
  } catch (e) {
    console.error(`engine:build: ${e.message}`)
    process.exit(1)
  }
}
