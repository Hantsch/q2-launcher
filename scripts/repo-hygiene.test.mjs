import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import yaml from 'js-yaml'

/**
 * Repo-wide line-ending and formatting invariants, read from the real repo (story 226): every
 * text file is LF in the index and in the worktree on every OS, so `prettier --check` (which CI
 * runs) cannot differ between a Windows and a Linux checkout.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const GITATTRIBUTES_PATH = fileURLToPath(new URL('../.gitattributes', import.meta.url))
const BLAME_IGNORE_PATH = fileURLToPath(new URL('../.git-blame-ignore-revs', import.meta.url))
const CI_WORKFLOW_PATH = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url))

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

function gitProbe(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

// verify:release runs the suite in a `checkout-index` snapshot that has no .git of its own; the
// git-backed checks only mean something when REPO_ROOT is the top of a real work tree.
const IS_WORK_TREE_ROOT = gitProbe(['rev-parse', '--show-prefix']) === ''
// CI's default checkout is depth 1, so older commits (the format commit) are not present there.
const IS_FULL_CLONE =
  IS_WORK_TREE_ROOT && gitProbe(['rev-parse', '--is-shallow-repository']) === 'false'

describe('line endings and formatting', () => {
  test.skipIf(!IS_WORK_TREE_ROOT)('every text file is LF in the worktree', () => {
    // Line shape: `i/<eol> w/<eol> attr/<attrs>\t<path>`. Files git detects as binary (`i/-text`,
    // e.g. sources carrying a literal NUL) are byte-exact and exempt.
    const offenders = git(['ls-files', '--eol'])
      .split('\n')
      .filter((line) => line.length > 0)
      .filter((line) => {
        const [info] = line.split('\t')
        const [index, worktree] = info.trim().split(/\s+/)
        return index !== 'i/-text' && (worktree === 'w/crlf' || worktree === 'w/mixed')
      })

    expect(offenders).toEqual([])
  })

  test('.gitattributes declares text=auto eol=lf and binary entries', () => {
    const lines = readFileSync(GITATTRIBUTES_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim().split(/\s+/).join(' '))

    expect(lines).toContain('* text=auto eol=lf')
    for (const pattern of ['*.png', '*.woff2', '*.zip', 'resources/bin/7za*']) {
      expect(lines).toContain(`${pattern} binary`)
    }
  })

  test('the format commit is blame-ignored', () => {
    const revs = readFileSync(BLAME_IGNORE_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))

    expect(revs.length).toBeGreaterThan(0)
    for (const rev of revs) {
      expect(rev).toMatch(/^[0-9a-f]{40}$/)
      if (!IS_FULL_CLONE) continue
      const probe = spawnSync('git', ['cat-file', '-e', `${rev}^{commit}`], { cwd: REPO_ROOT })
      expect(probe.status, `${rev} is not a commit in this repo`).toBe(0)
    }
  })

  test('ci runs format:check', () => {
    expect(readFileSync(CI_WORKFLOW_PATH, 'utf8')).toContain('npm run format:check')
  })
})

describe('no patched dependencies', () => {
  test('no patch-package, no patches dir, engines cover markAsUncloneable', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(existsSync(fileURLToPath(new URL('../patches', import.meta.url)))).toBe(false)
    expect(pkg.scripts.postinstall).toBeUndefined()
    expect(JSON.stringify(pkg)).not.toContain('patch-package')
    // markAsUncloneable exists from Node 22.10; 22.12 is the first LTS-line release with require(esm).
    expect(pkg.engines.node).toBe('>=22.12.0')
  })
})

describe('dependency floors', () => {
  const asNumbers = (version) => version.split('.').map((part) => Number.parseInt(part, 10))
  const atLeast = (version, floor) => {
    const [have, want] = [asNumbers(version), asNumbers(floor)]
    for (let i = 0; i < want.length; i += 1) {
      if (have[i] !== want[i]) return have[i] > want[i]
    }
    return true
  }

  test('the lockfile carries no advisory-affected electron or js-yaml', () => {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
    expect(atLeast(lock.packages['node_modules/electron'].version, '43.7.7')).toBe(true)
    expect(atLeast(lock.packages['node_modules/js-yaml'].version, '4.3.2')).toBe(true)
  })
})

describe('dependency automation', () => {
  const readRepo = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

  test('dependabot runs weekly with minor/patch grouped and majors separate', () => {
    const config = yaml.load(readRepo('../.github/dependabot.yml'))
    expect(config.version).toBe(2)
    expect(config.updates).toHaveLength(1)
    const [update] = config.updates
    expect(update['package-ecosystem']).toBe('npm')
    expect(update.schedule.interval).toBe('weekly')
    const groups = Object.values(update.groups)
    expect(groups.some((g) => [...g['update-types']].sort().join() === 'minor,patch')).toBe(true)
    expect(groups.some((g) => g['update-types']?.includes('major'))).toBe(false)
  })

  test('ci runs a non-blocking audit with a dated follow-up', () => {
    const ci = yaml.load(readRepo('../.github/workflows/ci.yml'))
    const steps = ci.jobs.test.steps
    const audit = steps.find((s) => s.run === 'npm audit --audit-level=high')
    expect(audit?.['continue-on-error']).toBe(true)
    const roadmap = readRepo('../docs/ROADMAP.md')
    expect(roadmap).toContain('npm audit')
    expect(roadmap).toContain('2026-10-09')
  })

  test('the roadmap carries no Vite pin follow-up', () => {
    expect(readRepo('../docs/ROADMAP.md')).not.toContain('Vite is pinned to 7.x')
  })
})
