// Story 085 D5: machine-verifies the external local checkout
// `C:\development\Hantsch\q2_community_content` against the contract D1/D4 wrote —
// layout, reserved READMEs, root README's required sections, byte-identity of
// `news/` with this repo's fixture copy, and the checkout's untouched git state
// (AC1/AC4/AC5/AC8, none of which a vitest run can see).
//
// Never a CI gate: if the checkout does not exist on this machine, the very first
// thing this script does is print a skip line and exit 0.
//
// Read-only: no file under `content/q2_community_content/**` or the checkout is
// ever written, and the only git subcommands run are read-only
// (rev-parse/status/branch/tag).
//
// Run by hand: `node scripts/check-content-repo.mjs` (or `npm run check:content-repo`).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CHECKOUT_ROOT = 'C:\\development\\Hantsch\\q2_community_content'
const EXPECTED_HEAD = '1fea243f4814a0b3e38fb93f26d59190b714e667'

const failures = []

/** Prints one pass/fail line for a single check and records failures. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`PASS ${label}`)
  } else {
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(detail ? `${label} — ${detail}` : label)
  }
}

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Recursively lists files under `dir`, returned as paths relative to `dir` (POSIX separators). */
function listFilesRecursive(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        out.push(relative(dir, full).split('\\').join('/'))
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

function runGit(args) {
  return execFileSync('git', ['-C', CHECKOUT_ROOT, ...args], { encoding: 'utf-8' })
}

function checkLayout() {
  for (const dir of ['news', 'news/img', 'packs', 'mods', 'config_templates']) {
    const full = join(CHECKOUT_ROOT, ...dir.split('/'))
    check(`layout: ${dir}/ exists`, existsSync(full) && statSync(full).isDirectory())
  }
}

function checkReservedReadmes() {
  for (const dir of ['packs', 'mods', 'config_templates']) {
    const path = join(CHECKOUT_ROOT, dir, 'README.md')
    const text = readTextIfExists(path)
    const lower = text?.toLowerCase() ?? ''
    const ok = text !== null && lower.includes('reserved') && lower.includes('not read')
    check(`reserved README: ${dir}/README.md states reserved/not read`, ok, text === null ? 'file missing' : undefined)
  }
}

function checkRootReadme() {
  const path = join(CHECKOUT_ROOT, 'README.md')
  const text = readTextIfExists(path)
  if (text === null) {
    check('root README.md exists', false, 'file missing')
    return
  }
  check('root README.md exists', true)

  const lower = text.toLowerCase()
  const requiredSubstrings = [
    ['top-level layout mentions engines/', /engines\//i],
    ['top-level layout mentions gamedata/', /gamedata\//i],
    ['index.json field: schemaVersion', /schemaVersion/],
    ['index.json field: entries', /entries/],
    ['index.json field: id', /\bid\b/],
    ['index.json field: file', /\bfile\b/],
    ['index.json field: order', /\border\b/],
    ['index.json field: visibleFrom', /visibleFrom/],
    ['index.json field: visibleUntil', /visibleUntil/],
    ['template: split', /\bsplit\b/],
    ['template: banner', /\bbanner\b/],
    ['template: text', /\btext\b/],
    ['button rule mentions max of 3', /\b3\b/],
    ['button rule mentions github.com', /github\.com/],
    ['button rule mentions raw.githubusercontent.com', /raw\.githubusercontent\.com/],
    ['visibility/order behaviour documented', /\border\b.*ascending|ascending.*\border\b/is],
    ['content-only rule documented', /content only/i],
    ['dropped-entry rule documented', /dropped/i],
  ]

  for (const [label, pattern] of requiredSubstrings) {
    check(`root README: ${label}`, pattern.test(text) || pattern.test(lower))
  }
}

function checkNewsByteIdentity() {
  const source = join(REPO_ROOT, 'content', 'q2_community_content', 'news')
  const target = join(CHECKOUT_ROOT, 'news')
  const sourceFiles = new Set(listFilesRecursive(source))
  const targetFiles = new Set(listFilesRecursive(target))
  const allFiles = new Set([...sourceFiles, ...targetFiles])

  for (const relPath of [...allFiles].sort()) {
    const inSource = sourceFiles.has(relPath)
    const inTarget = targetFiles.has(relPath)
    if (!inSource) {
      check(`news byte-identity: ${relPath}`, false, 'present in checkout but missing from this repo\'s fixture copy')
      continue
    }
    if (!inTarget) {
      check(`news byte-identity: ${relPath}`, false, 'present in this repo\'s fixture copy but missing from checkout')
      continue
    }
    const sourceHash = sha256OfFile(join(source, relPath))
    const targetHash = sha256OfFile(join(target, relPath))
    check(`news byte-identity: ${relPath}`, sourceHash === targetHash, sourceHash === targetHash ? undefined : 'content differs')
  }
}

function checkGitState() {
  let head
  try {
    head = runGit(['rev-parse', 'HEAD']).trim()
    check('git: HEAD is the pinned commit', head.startsWith(EXPECTED_HEAD) || EXPECTED_HEAD.startsWith(head), `expected ${EXPECTED_HEAD}, got ${head}`)
  } catch (error) {
    check('git: HEAD is the pinned commit', false, error.message)
  }

  try {
    const status = runGit(['status', '--porcelain'])
    const lines = status.split(/\r?\n/).filter((line) => line.length > 0)
    const notUntracked = lines.filter((line) => !line.startsWith('??'))
    check(
      'git: working tree changes are all untracked (??)',
      notUntracked.length === 0,
      notUntracked.length > 0 ? `staged/modified/tracked entries: ${notUntracked.join(', ')}` : undefined,
    )
  } catch (error) {
    check('git: working tree changes are all untracked (??)', false, error.message)
  }

  try {
    const branches = runGit(['branch'])
      .split(/\r?\n/)
      .map((line) => line.replace(/^\*?\s*/, '').trim())
      .filter((line) => line.length > 0)
    check(
      'git: no local branch besides main',
      branches.length === 1 && branches[0] === 'main',
      `local branches: ${branches.join(', ')}`,
    )
  } catch (error) {
    check('git: no local branch besides main', false, error.message)
  }

  try {
    const tags = runGit(['tag'])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    check('git: no tag exists', tags.length === 0, `tags: ${tags.join(', ')}`)
  } catch (error) {
    check('git: no tag exists', false, error.message)
  }
}

function main() {
  if (!existsSync(CHECKOUT_ROOT)) {
    console.log(`content repo checkout not found at ${CHECKOUT_ROOT}; skipping (nothing to verify on this machine)`)
    process.exit(0)
  }

  checkLayout()
  checkReservedReadmes()
  checkRootReadme()
  checkNewsByteIdentity()
  checkGitState()

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }

  console.log('\nall checks passed')
}

main()
