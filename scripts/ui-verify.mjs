// D6 (docs/requirements/026-ui-verification-harness.md): "the one command."
// Builds when the built app is missing, seeds when the fixture is missing,
// then runs `ui:shot` then `ui:a11y`, prints one combined summary and exits
// with the combined code. Run via `npm run ui:verify`.
//
// This file orchestrates only — it does not reimplement the build, the
// fixture seed, the screenshot pass or the a11y pass. Each stage is its own
// existing script/module, spawned or imported exactly the way `shot.mjs` and
// `a11y.mjs` already do, so the three entry points (`npm run ui:shot`,
// `npm run ui:a11y`, `npm run ui:verify`) always agree.
//
// Exit code (story 026 Decisions, combined across stages):
//   1 — a harness/app-level failure at any stage (build failed, or shot/a11y
//       themselves exited 1): reported first and takes priority.
//   2 — no harness failure, but the a11y stage found serious/critical
//       findings (its own exit code 2).
//   0 — clean.
//
// Deliberately NOT referenced by `test` or `build` (story 026 D6/AC9): this
// script is only ever invoked by a human or a build session running
// `npm run ui:verify` explicitly.
import { existsSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { FIXTURE_VARIANTS, writeFixture } from './lib/fixture.mjs'
import { REPO_ROOT, UI_VERIFY_ROOT } from './lib/paths.mjs'

const MAIN_ENTRY = join(REPO_ROOT, 'out', 'main', 'index.js')
const RENDERER_ENTRY = join(REPO_ROOT, 'out', 'renderer', 'index.html')

function fixtureDataPath(variant) {
  return join(UI_VERIFY_ROOT, 'fixture', variant, 'userdata', 'state.json')
}

/** Spawns `npm run build`, inheriting stdio so build output is visible. Returns true on exit 0. */
function runBuild() {
  console.log('ui:verify — build missing, running "npm run build"')
  try {
    // `shell: true` is required on Windows to execute `npm.cmd` directly via
    // execFileSync (a bare .cmd file is not itself an executable image).
    execFileSync(npmCommand(), ['run', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    return true
  } catch (error) {
    console.error(`ui:verify — build failed: ${error.message}`)
    return false
  }
}

/** `npm` on Windows is `npm.cmd`; `execFileSync` needs the exact executable name. */
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** Seeds any fixture variant that is missing, using the same writer `ui:seed` uses. */
function ensureFixtures() {
  const missing = FIXTURE_VARIANTS.filter((variant) => !existsSync(fixtureDataPath(variant)))
  if (missing.length === 0) return
  console.log(`ui:verify — fixture missing for ${missing.join(', ')}, seeding`)
  for (const variant of missing) writeFixture(variant)
}

/**
 * Spawns `node scripts/<script>`, inheriting stdio, and returns its exit code
 * without throwing — a non-zero exit from shot/a11y is a normal, expected
 * outcome this function reports rather than an error condition.
 */
function spawnStage(script) {
  console.log(`\nui:verify — running ${script}`)
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', script)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  return result.status ?? 1
}

function main() {
  if (!existsSync(MAIN_ENTRY) || !existsSync(RENDERER_ENTRY)) {
    if (!runBuild()) {
      console.error('\nui:verify — build failed, exit 1 (shot/a11y not attempted)')
      process.exitCode = 1
      return
    }
    if (!existsSync(MAIN_ENTRY) || !existsSync(RENDERER_ENTRY)) {
      console.error(
        'ui:verify — build reported success but the build output is still missing, exit 1',
      )
      process.exitCode = 1
      return
    }
  }

  ensureFixtures()

  const shotExit = spawnStage('shot.mjs')
  const a11yExit = spawnStage('a11y.mjs')

  console.log('\nui:verify — combined summary')
  console.log(`  shot exit code: ${shotExit}${shotExit === 1 ? ' (harness/app failure)' : ''}`)
  console.log(
    `  a11y exit code: ${a11yExit}` +
      (a11yExit === 1
        ? ' (harness/app failure)'
        : a11yExit === 2
          ? ' (serious/critical findings)'
          : ''),
  )

  let exitCode
  if (shotExit === 1 || a11yExit === 1) {
    exitCode = 1
    console.log('  result: FAILED — a harness/app-level stage failed, see output above')
  } else if (a11yExit === 2) {
    exitCode = 2
    console.log('  result: ACCESSIBILITY FINDINGS — serious/critical issues present, see a11y.md')
  } else {
    exitCode = 0
    console.log('  result: OK')
  }

  process.exitCode = exitCode
}

main()
