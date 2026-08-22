// D3 (docs/requirements/027-quiet-ui-verification.md): the one driver every
// UI-verification entry point goes through — `npm run ui:shot`, `npm run
// ui:a11y` and `npm run ui:verify` are all this file with different flags
// (see package.json). It replaces `scripts/shot.mjs`/`scripts/a11y.mjs`
// (deleted) and the two-child-process orchestration `scripts/ui-verify.mjs`
// used to do.
//
// What this file assembles, in order:
//  1. Build the app if `out/` is missing (`ui-verify.mjs`'s old job).
//  2. Resolve which screens run: the whole registry, or `--screens=a,b,c`
//     (unknown id = hard error, per story 027 AC8).
//  3. Call `runVariantSession()` (scripts/lib/session.mjs) once per fixture
//     variant actually needed by the resolved screens — that function owns
//     the one-launch-per-variant-plus-one-per-cold-start-screen guarantee
//     (story 027 D2). This file never calls `withApp()` itself.
//  4. Merge each session's results back into registry order. `runVariantSession`
//     necessarily returns all of one variant's results before the next
//     variant's (it batches by variant), so concatenating in call order would
//     scramble story 026's original `screen -> viewport` key order in
//     `run.json`/`a11y.json`. Re-sorting by the resolved screen list's own
//     order keeps that order regardless of how many variants were involved.
//  5. Write `run.json` (capture.shot) and `a11y.json`/`a11y.md` (capture.axe),
//     sweep stale screenshots (capture.shot AND the run was full — a partial
//     run must not touch screenshots for screens it did not visit), print one
//     summary with the real launch count, and set one exit code.
import { mkdirSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessError, REPO_ROOT, UI_VERIFY_ROOT } from './lib/paths.mjs'
import {
  AXE_DISABLED_RULES,
  AXE_DISABLED_RULES_REASON,
  SCREENSHOTS_DIR,
  runVariantSession,
  visitKey,
} from './lib/session.mjs'
import { SCREENS } from './lib/screens.mjs'

const RUN_LOG_PATH = join(UI_VERIFY_ROOT, 'run.json')
const A11Y_JSON_PATH = join(UI_VERIFY_ROOT, 'a11y.json')
const A11Y_MD_PATH = join(UI_VERIFY_ROOT, 'a11y.md')
const MAIN_ENTRY = join(REPO_ROOT, 'out', 'main', 'index.js')
const RENDERER_ENTRY = join(REPO_ROOT, 'out', 'renderer', 'index.html')

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor']

// --- CLI -------------------------------------------------------------------

/** `{ skipShot, skipAxe, screensFilter }`. Throws a plain `Error` on a bad flag — a usage mistake, not a `HarnessError`. */
function parseArgs(argv) {
  const flags = { skipShot: false, skipAxe: false, screensFilter: null }
  for (const arg of argv) {
    if (arg === '--skip-shot') flags.skipShot = true
    else if (arg === '--skip-axe') flags.skipAxe = true
    else if (arg.startsWith('--screens=')) {
      flags.screensFilter = arg
        .slice('--screens='.length)
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    } else {
      throw new Error(`verify.mjs: unknown flag "${arg}"`)
    }
  }
  if (flags.skipShot && flags.skipAxe) {
    throw new Error('verify.mjs: --skip-shot and --skip-axe together would capture nothing')
  }
  if (flags.screensFilter && flags.screensFilter.length === 0) {
    throw new Error('verify.mjs: --screens= needs at least one screen id')
  }
  return flags
}

/**
 * The registry, filtered to `ids`. Throws — naming the bad id — if any requested
 * id does not exist (story 027 AC8: fail fast, clear message), rather than
 * silently running a smaller set than asked for.
 *
 * Ids are deduplicated and the result keeps *registry* order, not the order they
 * were typed in: the merge below turns this list into `run.json`'s key order, so
 * `--screens=settings,home` must produce the same file as `--screens=home,settings`,
 * and `--screens=home,home` must not be able to inflate `screens.length` into
 * passing for a full run and triggering the stale-PNG sweep.
 */
function resolveScreens(ids) {
  if (!ids) return SCREENS
  const known = new Set(SCREENS.map((screen) => screen.id))
  const requested = [...new Set(ids)]
  const unknown = requested.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    const validIds = SCREENS.map((screen) => screen.id).join(', ')
    throw new Error(
      `verify.mjs: unknown screen id(s) in --screens: ${unknown.join(', ')} — valid ids: ${validIds}`,
    )
  }
  const wanted = new Set(requested)
  return SCREENS.filter((screen) => wanted.has(screen.id))
}

// --- build -------------------------------------------------------------------

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** Spawns `npm run build`, inheriting stdio. Returns true on exit 0 — mirrors old ui-verify.mjs. */
function runBuild() {
  console.log('verify.mjs — build missing, running "npm run build"')
  try {
    execFileSync(npmCommand(), ['run', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    return true
  } catch (error) {
    console.error(`verify.mjs — build failed: ${error.message}`)
    return false
  }
}

/** Builds if `out/` is missing/incomplete. Throws a plain `Error` if it is still missing afterwards. */
function ensureBuilt() {
  if (existsSync(MAIN_ENTRY) && existsSync(RENDERER_ENTRY)) return
  if (!runBuild()) throw new Error('verify.mjs: build failed, exit 1 (nothing was run)')
  if (!existsSync(MAIN_ENTRY) || !existsSync(RENDERER_ENTRY)) {
    throw new Error('verify.mjs: build reported success but the build output is still missing')
  }
}

// --- merge -------------------------------------------------------------------

/**
 * Runs every variant `screens` touches and merges results back into registry
 * order. `runVariantSession` returns one variant's results at a time (it has
 * to — it batches launches by variant), so a caller wanting story 026's
 * original `screen x viewport` key order has to re-sort by the resolved
 * screen list's own position, not by the order the sessions happened to run.
 */
async function runAllVariants({ screens, capture }) {
  const variants = [...new Set(screens.map((screen) => screen.variant))]

  let launches = 0
  const byKey = new Map()
  // A session can fail as a whole without any single visit being to blame — the
  // app dying once its last screen was already captured. Nothing in `results`
  // records that, so it is carried here and fails the run on its own.
  const sessionErrors = []
  for (const variant of variants) {
    const session = await runVariantSession({ variant, screens, capture })
    launches += session.launches
    if (session.error) sessionErrors.push({ variant, reason: session.error })
    for (const result of session.results) byKey.set(result.key, result)
  }

  const results = []
  for (const screen of screens) {
    for (const viewport of screen.viewports) {
      const key = visitKey(screen.id, viewport)
      const result = byKey.get(key)
      if (!result) {
        // Cannot happen if runVariantSession honours its own contract, but a
        // silently dropped visit would be worse than a loud one.
        throw new HarnessError(`verify.mjs: no result came back for ${key}`)
      }
      results.push(result)
    }
  }
  return { launches, results, sessionErrors }
}

// --- shot side effects (screenshots already written by session.mjs) --------

/** Renames every pre-existing PNG this run did not (re)write to `*.png.stale`. Only called for a full, shot-capturing run. */
function sweepStale(results) {
  const writtenFilenames = new Set(
    results.filter((result) => result.written).map((result) => result.filename),
  )
  mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  for (const entry of readdirSync(SCREENSHOTS_DIR)) {
    if (!entry.endsWith('.png')) continue
    if (writtenFilenames.has(entry)) continue
    renameSync(join(SCREENSHOTS_DIR, entry), join(SCREENSHOTS_DIR, `${entry}.stale`))
  }
}

// --- report writers ----------------------------------------------------------

function writeRunLog(results) {
  const byKey = {}
  for (const result of results) byKey[result.key] = result.shot
  mkdirSync(UI_VERIFY_ROOT, { recursive: true })
  writeFileSync(RUN_LOG_PATH, `${JSON.stringify(byKey, null, 2)}\n`, 'utf8')
}

function writeA11yJson(results) {
  const byKey = {}
  for (const result of results) byKey[result.key] = result.axe
  mkdirSync(UI_VERIFY_ROOT, { recursive: true })
  writeFileSync(A11Y_JSON_PATH, `${JSON.stringify(byKey, null, 2)}\n`, 'utf8')
}

/** Verbatim from story 026's a11y.mjs `buildMarkdown`, adapted to read `result.axe` instead of a `{key, record}` pair. */
function buildA11yMarkdown(results) {
  const lines = ['# Accessibility report (axe-core)', '']

  const totalsByImpact = Object.fromEntries(IMPACT_ORDER.map((impact) => [impact, 0]))
  const unreachable = []
  for (const { key, axe } of results) {
    if (axe.status !== 'audited') {
      unreachable.push({ key, status: axe.status, reason: axe.reason })
      continue
    }
    for (const violation of axe.violations) {
      if (totalsByImpact[violation.impact] !== undefined) totalsByImpact[violation.impact] += 1
      else totalsByImpact[violation.impact] = 1
    }
  }

  lines.push('## Summary', '')
  for (const impact of IMPACT_ORDER) {
    lines.push(`- **${impact}**: ${totalsByImpact[impact]} rule finding(s)`)
  }
  if (unreachable.length > 0) {
    lines.push(`- **unreachable/errored screens**: ${unreachable.length}`)
  }
  lines.push(
    `- **disabled rule(s)**: ${AXE_DISABLED_RULES.join(', ')} — ${AXE_DISABLED_RULES_REASON}`,
  )
  lines.push('')

  if (unreachable.length > 0) {
    lines.push('## Screens not audited', '')
    lines.push('| Screen | Status | Reason |')
    lines.push('| --- | --- | --- |')
    for (const { key, status, reason } of unreachable) {
      const reasonText = (reason ?? '').split('\n')[0].replace(/\|/g, '\\|')
      lines.push(`| ${key} | ${status} | ${reasonText} |`)
    }
    lines.push('')
  }

  for (const impact of IMPACT_ORDER) {
    const rows = []
    for (const { key, axe } of results) {
      if (axe.status !== 'audited') continue
      for (const violation of axe.violations) {
        if (violation.impact !== impact) continue
        rows.push({ screen: key, violation })
      }
    }
    if (rows.length === 0) continue

    lines.push(`## ${impact[0].toUpperCase()}${impact.slice(1)}`, '')
    lines.push('| Screen | Rule | Nodes | Help |')
    lines.push('| --- | --- | --- | --- |')
    for (const { screen, violation } of rows) {
      lines.push(
        `| ${screen} | ${violation.id} | ${violation.nodeCount} | [${violation.help}](${violation.helpUrl}) |`,
      )
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

// --- summary + exit code ------------------------------------------------------

/** The npm script this invocation actually is — a `--skip-axe` run must not claim to be `ui:verify`. */
function summaryLabel(capture) {
  if (capture.shot && capture.axe) return 'ui:verify'
  return capture.shot ? 'ui:shot' : 'ui:a11y'
}

function printSummary({ results, capture, launches, full, screens, sessionErrors }) {
  console.log(`\n${summaryLabel(capture)} summary`)

  let written = 0
  let unreachable = 0
  let error = 0
  const totalsByImpact = Object.fromEntries(IMPACT_ORDER.map((impact) => [impact, 0]))

  for (const result of results) {
    const bits = [result.key]

    if (capture.shot) {
      const shot = result.shot
      bits.push(`shot:${shot.status}`)
      if (shot.consoleErrors?.length) bits.push(`${shot.consoleErrors.length} console error(s)`)
      if (shot.pageErrors?.length) bits.push(`${shot.pageErrors.length} page error(s)`)
      if (shot.reason) bits.push(`(${shot.reason.split('\n')[0]})`)
      if (shot.status === 'written') written += 1
      else if (shot.status === 'unreachable') unreachable += 1
      else error += 1
    }

    if (capture.axe) {
      const axe = result.axe
      const byImpact = {}
      for (const violation of axe.violations ?? []) {
        byImpact[violation.impact] = (byImpact[violation.impact] ?? 0) + 1
        // Only an audited screen's violations count toward the run-level totals —
        // matching `buildA11yMarkdown`, which excludes unreachable/errored screens
        // from its summary. The per-line detail below still shows them.
        if (axe.status === 'audited' && totalsByImpact[violation.impact] !== undefined) {
          totalsByImpact[violation.impact] += 1
        }
      }
      const impactBits = IMPACT_ORDER.filter((impact) => byImpact[impact] > 0).map(
        (impact) => `${byImpact[impact]} ${impact}`,
      )
      const detail =
        impactBits.length > 0
          ? ` (${impactBits.join(', ')})`
          : axe.status === 'audited'
            ? ' (clean)'
            : axe.reason
              ? ` (${axe.reason.split('\n')[0]})`
              : ''
      bits.push(`axe:${axe.status}${detail}`)
    }

    console.log(`  ${bits.join(' — ')}`)
  }

  console.log(`\nlaunches: ${launches}`)
  for (const { variant, reason } of sessionErrors) {
    console.log(`session failure (${variant}): ${reason.split('\n')[0]}`)
  }
  if (capture.shot) {
    console.log(
      `shot: ${written} written, ${unreachable} unreachable, ${error} error(s) (${results.length} total)`,
    )
  }
  if (capture.axe) {
    console.log(
      `axe violations: ${IMPACT_ORDER.map((impact) => `${totalsByImpact[impact]} ${impact}`).join(', ')}`,
    )
    console.log(
      `axe disabled rule(s): ${AXE_DISABLED_RULES.join(', ')} — ${AXE_DISABLED_RULES_REASON}`,
    )
  }

  if (full) {
    console.log(
      `run: full (${screens.length}/${SCREENS.length} screens)${capture.shot ? ' — stale screenshots swept' : ''}`,
    )
  } else {
    console.log(
      `run: PARTIAL — ${screens.length}/${SCREENS.length} screens (--screens=${screens.map((s) => s.id).join(',')}) — stale-PNG sweep skipped`,
    )
  }

  return { totalsByImpact }
}

/**
 * `0` clean, `1` any visit's harness/app failed (unreachable screen, console
 * error, main crash, launch failure) or a session failed as a whole, `2` no
 * harness failure but the a11y capture found a serious/critical violation.
 * Unchanged from story 026's contract, computed once here instead of derived
 * from two child exit codes — `sessionErrors` is what keeps an app that died
 * *after* its last screenshot at exit 1, the way story 026's per-screen
 * `withApp()` outer catch did.
 */
function computeExitCode({ results, capture, totalsByImpact, sessionErrors }) {
  const harnessFailed = results.some((result) => result.harnessOk === false)
  if (harnessFailed || sessionErrors.length > 0) return 1
  if (capture.axe && (totalsByImpact.critical > 0 || totalsByImpact.serious > 0)) return 2
  return 0
}

// --- entry point ---------------------------------------------------------------

/**
 * Runs the driver for `argv` (CLI flag strings, e.g. `['--skip-axe']`) and
 * returns the process exit code (never throws for an expected failure — a bad
 * flag, an unknown screen id and a failed build are all reported and turned
 * into `1`). This is the function both `node scripts/verify.mjs <flags>` at
 * the bottom of this file and `scripts/ui-verify.mjs` call — the latter
 * in-process, with no child process involved.
 */
export async function run(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (error) {
    console.error(error.message)
    return 1
  }

  const capture = { shot: !flags.skipShot, axe: !flags.skipAxe }

  let screens
  try {
    screens = resolveScreens(flags.screensFilter)
  } catch (error) {
    console.error(error.message)
    return 1
  }
  const full = screens.length === SCREENS.length

  try {
    ensureBuilt()
  } catch (error) {
    console.error(error.message)
    return 1
  }

  const { launches, results, sessionErrors } = await runAllVariants({ screens, capture })

  if (capture.shot) {
    writeRunLog(results)
    if (full) sweepStale(results)
  }
  if (capture.axe) {
    writeA11yJson(results)
    writeFileSync(A11Y_MD_PATH, buildA11yMarkdown(results), 'utf8')
  }

  const { totalsByImpact } = printSummary({
    results,
    capture,
    launches,
    full,
    screens,
    sessionErrors,
  })
  return computeExitCode({ results, capture, totalsByImpact, sessionErrors })
}

/** True when this file was run directly (`node scripts/verify.mjs`), not imported. Mirrors harness.mjs's own self-check guard. */
function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  const self = fileURLToPath(import.meta.url)
  return process.platform === 'win32'
    ? resolve(entry).toLowerCase() === self.toLowerCase()
    : resolve(entry) === self
}

if (isDirectRun()) {
  process.exitCode = await run(process.argv.slice(2))
}
