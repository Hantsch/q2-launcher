// D4 (docs/requirements/026-ui-verification-harness.md): drives every screen
// in `scripts/lib/screens.mjs` through the built app and leaves behind one
// screenshot per screen per viewport under `.ui-verify/screenshots/`, plus a
// machine-readable `.ui-verify/run.json` and a console summary. Run via
// `npm run ui:shot`.
//
// Seeds the fixture itself when missing, by calling `writeFixture()` directly
// (the same function `scripts/seed.mjs` calls) rather than spawning a child
// `node scripts/seed.mjs` — one less process to wire stdio through for the
// same effect.
//
// A screen whose `navigate()` cannot reach its target (a testid that never
// appears, per the story: "removing a testid makes exactly that screen report
// unreachable") is recorded as `unreachable` and does not abort the run —
// every other screen is still attempted. A screen that renders but logs a
// renderer console error or an uncaught exception is recorded as `error`
// rather than `written`, per story 026 D4's acceptance: "a screen that logs a
// renderer console error exits 1 and the message appears in run.json."
//
// Exit code: 0 only if every screen is `written` with zero console/page
// errors and the main process never crashed; 1 otherwise.
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURE_VARIANTS, writeFixture } from './lib/fixture.mjs'
import { HarnessError, withApp } from './lib/harness.mjs'
import { UI_VERIFY_ROOT } from './lib/paths.mjs'
import { SCREENS } from './lib/screens.mjs'

const SCREENSHOTS_DIR = join(UI_VERIFY_ROOT, 'screenshots')
const RUN_LOG_PATH = join(UI_VERIFY_ROOT, 'run.json')

function fixtureDataPath(variant) {
  return join(UI_VERIFY_ROOT, 'fixture', variant, 'userdata', 'state.json')
}

/** Seeds only the variants a registry entry actually needs and that are missing — `ui:seed` stays the explicit, always-both-variants entry point. */
function ensureFixtures() {
  const needed = new Set(SCREENS.map((entry) => entry.variant))
  const missing = FIXTURE_VARIANTS.filter(
    (variant) => needed.has(variant) && !existsSync(fixtureDataPath(variant)),
  )
  if (missing.length === 0) return
  console.log(`fixture missing for ${missing.join(', ')} — seeding (npm run ui:seed logic)`)
  for (const variant of missing) writeFixture(variant)
}

function screenshotFilename(id, viewport) {
  return `${id}@${viewport.width}x${viewport.height}.png`
}

/** Renames every pre-existing PNG this run did not (re)write to `*.png.stale`, before the new files land — a stale name can never collide with one this run is about to write. */
function renamePreexistingToStale(writtenFilenames) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  for (const entry of readdirSync(SCREENSHOTS_DIR)) {
    if (!entry.endsWith('.png')) continue
    if (writtenFilenames.has(entry)) continue
    renameSync(join(SCREENSHOTS_DIR, entry), join(SCREENSHOTS_DIR, `${entry}.stale`))
  }
}

/**
 * Runs one registry entry at one viewport. Never throws: every failure mode
 * (navigate() rejecting because a testid never showed up, the app crashing,
 * the harness itself refusing to launch) is turned into a `run.json` entry
 * instead, so the caller can attempt every other screen regardless.
 */
async function shootOne(entry, viewport) {
  const key = `${entry.id}@${viewport.width}x${viewport.height}`
  const filename = screenshotFilename(entry.id, viewport)
  const filePath = join(SCREENSHOTS_DIR, filename)

  try {
    const outcome = await withApp({ variant: entry.variant, viewport }, async ({ page, log }) => {
      try {
        await entry.navigate(page)
        await page.screenshot({ path: filePath })
        return { reached: true, log }
      } catch (error) {
        return { reached: false, reason: error.message, log }
      }
    })

    const { log } = outcome
    if (!outcome.reached) {
      return {
        key,
        filename,
        written: false,
        record: {
          status: 'unreachable',
          consoleErrors: log.errors.map((message) => message.text),
          pageErrors: log.pageErrors,
          reason: outcome.reason,
        },
      }
    }

    const hasFailures = log.errors.length > 0 || log.pageErrors.length > 0 || log.mainCrashed
    return {
      key,
      filename,
      written: true,
      record: {
        status: hasFailures ? 'error' : 'written',
        consoleErrors: log.errors.map((message) => message.text),
        pageErrors: log.pageErrors,
      },
    }
  } catch (error) {
    // withApp itself failed (build missing, containment guard, main crash the
    // screen's own fn never got a chance to observe) — no file was written.
    return {
      key,
      filename,
      written: false,
      record: {
        status: 'error',
        consoleErrors: [],
        pageErrors: [],
        reason: error instanceof HarnessError ? error.message : String(error.message ?? error),
      },
    }
  }
}

function printSummary(entries) {
  console.log('\nui:shot summary')
  let writtenCount = 0
  let unreachableCount = 0
  let errorCount = 0
  for (const { key, record } of entries) {
    const bits = [key, record.status]
    if (record.consoleErrors.length > 0) bits.push(`${record.consoleErrors.length} console error(s)`)
    if (record.pageErrors.length > 0) bits.push(`${record.pageErrors.length} page error(s)`)
    if (record.reason) bits.push(`(${record.reason.split('\n')[0]})`)
    console.log(`  ${bits.join(' — ')}`)
    if (record.status === 'written') writtenCount += 1
    else if (record.status === 'unreachable') unreachableCount += 1
    else errorCount += 1
  }
  console.log(
    `\n${writtenCount} written, ${unreachableCount} unreachable, ${errorCount} error(s) ` +
      `(${entries.length} total)`,
  )
}

async function main() {
  ensureFixtures()
  mkdirSync(SCREENSHOTS_DIR, { recursive: true })

  const results = {}
  const writtenFilenames = new Set()
  const entries = []

  for (const entry of SCREENS) {
    for (const viewport of entry.viewports) {
      const outcome = await shootOne(entry, viewport)
      results[outcome.key] = outcome.record
      entries.push(outcome)
      if (outcome.written) writtenFilenames.add(outcome.filename)
    }
  }

  renamePreexistingToStale(writtenFilenames)

  mkdirSync(UI_VERIFY_ROOT, { recursive: true })
  writeFileSync(RUN_LOG_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8')

  printSummary(entries)

  const clean = entries.every((outcome) => outcome.record.status === 'written')
  process.exitCode = clean ? 0 : 1
}

await main()
