import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, matchesGlob } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import yaml from 'js-yaml'
import vitestConfig from '../vitest.config.ts'
import docsConfig from '../vitest.docs.config.ts'

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
    // jsdom 30 and undici 8 (dev) need Node >=22.19; CI pins 22.22.2 in .node-version (story 271).
    expect(pkg.engines.node).toBe('>=22.22.2')
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
    expect(atLeast(lock.packages['node_modules/electron'].version, '43.8.4')).toBe(true)
    expect(atLeast(lock.packages['node_modules/js-yaml'].version, '4.3.2')).toBe(true)
  })
})

describe('dependency automation', () => {
  const readRepo = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

  test('dependency updates are done in the project, not by a bot', () => {
    expect(existsSync(new URL('../.github/dependabot.yml', import.meta.url))).toBe(false)
  })

  test('the ci audit step blocks a PR', () => {
    const ci = yaml.load(readRepo('../.github/workflows/ci.yml'))
    const audit = ci.jobs.test.steps.find((s) => s.run === 'npm audit --audit-level=high')
    expect(audit).toBeDefined()
    expect(audit.name).toBe('Audit')
    expect(audit['continue-on-error']).toBeUndefined()
  })
})

describe('test discovery', () => {
  const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

  // A test file no include glob matches is silently never run.
  const orphanTestFiles = (paths, include) =>
    paths.filter(
      (path) =>
        TEST_FILE.test(path) &&
        !path.split('/').includes('node_modules') &&
        !include.some((glob) => matchesGlob(path, glob)),
    )

  test.skipIf(!IS_WORK_TREE_ROOT)('every tracked test file is inside a vitest include glob', () => {
    const tracked = git(['ls-files']).split('\n').filter(Boolean)

    expect(orphanTestFiles(tracked, vitestConfig.test.include)).toEqual([])
  })

  test('a test file outside the include globs is reported', () => {
    const paths = [
      'scripts/foo.test.cjs',
      'src/a.test.ts',
      'scripts/b.test.mjs',
      'src/__snapshots__/a.test.ts.snap',
      'node_modules/x/y.test.js',
    ]

    expect(orphanTestFiles(paths, vitestConfig.test.include)).toEqual(['scripts/foo.test.cjs'])
  })

  test.skipIf(!IS_WORK_TREE_ROOT)(
    'every docs-lane test file runs in check:docs and not in npm test',
    () => {
      const docsFiles = git(['ls-files'])
        .split('\n')
        .filter((path) => /\.docs\.test\.[cm]?[jt]sx?$/.test(path))

      for (const path of docsFiles) {
        expect(
          docsConfig.test.include.some((glob) => matchesGlob(path, glob)),
          `${path} is not in the docs config include`,
        ).toBe(true)
        expect(
          vitestConfig.test.exclude.some((glob) => matchesGlob(path, glob)),
          `${path} is not excluded from the base config`,
        ).toBe(true)
      }
    },
  )

  test('check:docs fails when either the link checker or the docs lane fails', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const script = pkg.scripts['check:docs']

    expect(script).toMatch(/^node scripts\/check-docs\.mjs && .*--config vitest\.docs\.config\.ts/)
    expect(script).not.toContain('--passWithNoTests')
  })
})

describe('flows wait on conditions', () => {
  // Shrink only: a flow leaves this list when it is fixed.
  const LEGACY_SLEEP_ALLOWLIST = Object.freeze([
    'scripts/flows/controls-extra-keys.mjs',
    'scripts/flows/drop-message-checkbox.mjs',
    'scripts/flows/grenade-rows-take-a-key.mjs',
    'scripts/flows/home-dashboard-arrange.mjs',
    'scripts/flows/home-hero-carousel.mjs',
    'scripts/flows/news-cover-template.mjs',
    'scripts/flows/replays-bulk-delete.mjs',
    'scripts/flows/replays-bulk-one-selected.mjs',
    'scripts/flows/replays-demo-context-menu.mjs',
    'scripts/flows/replays-demo-file-actions.mjs',
    'scripts/flows/replays-detail-always-shown.mjs',
    'scripts/flows/replays-folder-drag-move.mjs',
    'scripts/flows/replays-multi-select.mjs',
    'scripts/flows/replays-name-templates.mjs',
    'scripts/flows/servers-lan-no-scan-while-playing.mjs',
    'scripts/flows/servers-no-scan-while-playing.mjs',
    'scripts/lib/servers-lan-flow.mjs',
  ])

  const filesWithFixedSleeps = (root) => {
    const found = []
    const walk = (relDir) => {
      const dir = join(root, relDir)
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = `${relDir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (
          entry.name.endsWith('.mjs') &&
          readFileSync(join(root, rel), 'utf8').includes('waitForTimeout')
        ) {
          found.push(rel)
        }
      }
    }
    walk('scripts/flows')
    walk('scripts/lib')
    return found.sort()
  }

  test('a flow with one fixed sleep is reported', () => {
    const root = mkdtempSync(join(tmpdir(), 'sleep-ratchet-'))
    try {
      mkdirSync(join(root, 'scripts', 'flows'), { recursive: true })
      writeFileSync(
        join(root, 'scripts', 'flows', 'fixture-flow.mjs'),
        'await page.waitForTimeout(100)\n',
      )

      expect(filesWithFixedSleeps(root)).toEqual(['scripts/flows/fixture-flow.mjs'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('no flow outside the legacy allowlist sleeps on a fixed timeout', () => {
    expect(
      filesWithFixedSleeps(REPO_ROOT).filter((f) => !LEGACY_SLEEP_ALLOWLIST.includes(f)),
    ).toEqual([])
  })

  test('every legacy allowlist entry still sleeps', () => {
    const sleeping = filesWithFixedSleeps(REPO_ROOT)

    expect(LEGACY_SLEEP_ALLOWLIST.filter((f) => !sleeping.includes(f))).toEqual([])
  })
})
