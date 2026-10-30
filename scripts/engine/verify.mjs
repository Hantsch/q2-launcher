// `npm run engine:verify [-- --only=<n|substring>[,...]]`: end-to-end checks of the WebAssembly engine
// build. Needs Docker; builds run for minutes, so this is a local lane, never part of `npm test`. (story 281)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { engineImageTag, fwd } from './build.mjs'
import { checkSymbols, defaultSymbolRules, readUpstream } from './lib.mjs'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const OUT = join(ROOT, 'resources/engine')
const WASM = join(OUT, 'q2pro.wasm')
const JS = join(OUT, 'q2pro.js')
const LOG_DIR = join(ROOT, 'spikes/281-engine-build/results')
const LOG = join(LOG_DIR, 'verify.log')

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const clearArtefacts = () => {
  for (const f of [JS, WASM]) rmSync(f, { force: true })
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

function build(...extra) {
  const r = spawnSync('node', [join(ROOT, 'scripts/engine/build.mjs'), ...extra], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function mustBuild(...extra) {
  const r = build(...extra)
  expect(r.status === 0, `build ${extra.join(' ')} exited ${r.status}\n${r.out.slice(-1500)}`)
  return r
}

// Wasm of the default-level build; a slice that skips check 1 (or follows check 3) builds it first.
let firstHash
const baseline = () => {
  if (!existsSync(WASM)) mustBuild()
  return (firstHash ??= sha(WASM))
}

function todayStamps() {
  const d = new Date()
  const mon = d.toLocaleString('en-US', { month: 'short' })
  // __DATE__ pads the day with a space.
  return [
    `${mon} ${String(d.getDate()).padStart(2, ' ')} ${d.getFullYear()}`,
    `${mon} ${d.getDate()} ${d.getFullYear()}`,
  ]
}

function objdump() {
  const tag = engineImageTag(ROOT)
  return spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${fwd(OUT)}:/engine-out:ro`,
      '-v',
      `${fwd(join(ROOT, 'engine/docker/build.sh'))}:/engine/build.sh:ro`,
      tag,
      'bash',
      '/engine/build.sh',
      '--objdump',
      '/engine-out/q2pro.wasm',
    ],
    { encoding: 'utf8', maxBuffer: 1 << 29, env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  )
}

function brokenPatchDir() {
  const dir = mkdtempSync(join(tmpdir(), 'engine-patches-'))
  const src = join(ROOT, 'engine/patches')
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(dir, f))
  const body = [
    'diff --git a/no/such/file.c b/no/such/file.c',
    '--- a/no/such/file.c',
    '+++ b/no/such/file.c',
    '@@ -1,1 +1,1 @@',
    '-this line does not exist',
    '+neither does this one',
    '',
  ]
  writeFileSync(join(dir, '9999-broken.patch'), body.join('\n'))
  return dir
}

const checks = [
  [
    'a clean build writes q2pro.js and q2pro.wasm',
    () => {
      rmSync(join(ROOT, '.engine-build'), { recursive: true, force: true })
      clearArtefacts()
      mustBuild()
      expect(existsSync(JS) && existsSync(WASM), 'q2pro.js or q2pro.wasm missing after build')
      firstHash = sha(WASM)
    },
  ],
  [
    'the build checks out the UPSTREAM commit',
    () => {
      const { commit } = readUpstream(readFileSync(join(ROOT, 'engine/UPSTREAM'), 'utf8'))
      const r = spawnSync('git', ['-C', join(ROOT, '.engine-build/src'), 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      })
      const head = r.stdout.trim()
      expect(head === commit, `HEAD is ${head || r.stderr.trim()}, expected ${commit}`)
    },
  ],
  [
    'a patch that does not apply fails the build and writes no artefact',
    () => {
      const dir = brokenPatchDir()
      try {
        baseline()
        clearArtefacts()
        const r = build(`--patches-dir=${dir}`)
        expect(r.status !== 0, 'build with a broken patch exited 0')
        const at = r.out.indexOf('applying 9999-broken.patch')
        expect(at >= 0, `output never reached the broken patch: ${r.out.slice(-1500)}`)
        expect(/error:/.test(r.out.slice(at)), 'no git apply error follows the broken patch')
        expect(!existsSync(JS) && !existsSync(WASM), 'artefacts were written despite the failure')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  ],
  [
    'two builds produce the same wasm hash',
    () => {
      const first = baseline()
      mustBuild()
      expect(sha(WASM) === first, `wasm hash differs between builds: ${first} vs ${sha(WASM)}`)
      for (const f of [JS, WASM]) {
        const text = readFileSync(f).toString('latin1')
        for (const s of todayStamps())
          expect(!text.includes(s), `${f} contains today's date "${s}"`)
      }
    },
  ],
  [
    'check-config shows curl and openal disabled and no server or game target',
    () => {
      const { out } = mustBuild('--check-config')
      expect(out.includes('libcurl=disabled'), 'libcurl is not disabled')
      expect(out.includes('openal=disabled'), 'openal is not disabled')
      const bad = out.split(/\r?\n/).filter((l) => /^target: (q2proded|game)/.test(l.trim()))
      expect(bad.length === 0, `unexpected targets: ${bad.join(', ')}`)
    },
  ],
  [
    'the artefact carries no server, game, curl or openal symbols',
    () => {
      expect(existsSync(WASM), 'no q2pro.wasm to inspect')
      const r = objdump()
      expect(r.status === 0, `objdump exited ${r.status}: ${(r.stderr ?? '').slice(-500)}`)
      const res = checkSymbols(r.stdout, defaultSymbolRules)
      const none = (a) => a.join(', ') || '-'
      expect(
        res.ok,
        `forbidden: ${none(res.forbidden)}; missing required: ${none(res.missingRequired)}`,
      )
    },
  ],
  [
    'each optimisation level builds its own artefact',
    () => {
      const first = baseline()
      const hashes = new Set([first])
      for (const [level, num] of [
        ['O1', 1],
        ['O0', 0],
      ]) {
        const cfg = mustBuild(`--opt=${level}`, '--check-config').out
        expect(
          cfg.includes(`optimization=${num}`),
          `${level}: check-config lacks optimization=${num}`,
        )
        mustBuild(`--opt=${level}`)
        const h = sha(WASM)
        expect(!hashes.has(h), `${level} wasm hash equals another level's`)
        hashes.add(h)
      }
      mustBuild()
      expect(sha(WASM) === first, 'final default-level build differs from the first one')
    },
  ],
  [
    'a build leaves the working tree clean',
    () => {
      const r = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' })
      const hits = r.stdout
        .split(/\r?\n/)
        .filter((l) => /resources\/engine\/|\.engine-build/.test(l))
      expect(hits.length === 0, `build output shows in git status: ${hits.join('; ')}`)
    },
  ],
]

function selected(only) {
  if (!only) return checks
  const keys = only.split(',')
  return checks.filter(([name], i) => keys.some((k) => k === String(i + 1) || name.includes(k)))
}

function runCheck([name, fn]) {
  const t0 = Date.now()
  let verdict = 'PASS'
  let detail = ''
  try {
    fn()
  } catch (e) {
    verdict = 'FAIL'
    detail = `\n    ${String(e.message).split('\n').join('\n    ')}`
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  return { failed: verdict === 'FAIL', line: `${verdict} ${name} (${secs}s)${detail}` }
}

function main(argv) {
  const only = argv.find((a) => a.startsWith('--only='))?.slice(7)
  mkdirSync(LOG_DIR, { recursive: true })
  const lines = []
  let failed = 0
  for (const check of selected(only)) {
    const r = runCheck(check)
    console.log(r.line)
    lines.push(r.line)
    if (r.failed) failed++
  }
  const summary = failed ? `${failed} check(s) failed` : 'all checks passed'
  console.log(summary)
  const body = `${lines.join('\n')}\n${summary}\n`
  if (only) appendFileSync(LOG, `\n# partial run (--only=${only})\n${body}`)
  else writeFileSync(LOG, body)
  return failed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)) ? 1 : 0)
}
