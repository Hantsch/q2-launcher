// D2 (docs/requirements/027-quiet-ui-verification.md): the one driver every
// UI-verification entry point goes through.
//
// Story 026 shipped `shot.mjs` and `a11y.mjs` as two loops that each called
// `withApp()` per screen per viewport — 14 x 2 x 2 = 56 `_electron.launch()`
// calls per `ui:verify`. This file replaces both loops with *one launch per
// fixture variant*: the app stays up and the driver walks it screen by screen,
// capturing the screenshot and the axe scan back to back on the same page
// state (story 027 AC3 — `a11y.json` provably describes the state in the PNG).
//
// Four guarantees this file exists to hold, each of which a naive "just hoist
// the launch out of the loop" rewrite quietly loses:
//
//  1. **Every screen starts from the state its `navigate()` documents.** The
//     registry's navigate functions assume a fresh app load. Without a
//     relaunch that is no longer automatic: `ConfigView` keeps its own
//     `screen`/`activeTab` state, and a leftover `Modal` renders a
//     full-viewport scrim that swallows clicks, and a screen that trips the
//     `ErrorBoundary` takes the whole shell down for good. `resetToBaseState()`
//     restores the precondition before every visit — see its comment.
//  2. **Per-screen attribution.** `RunLog` accumulates for the whole session,
//     so console errors and renderer exceptions are *sliced* per visit rather
//     than read as session totals. A screen only ever owns what happened
//     between its own start and its own end.
//  3. **One screen's failure costs only that screen.** Every visit runs in its
//     own try/catch and is classified `written`/`audited`/`unreachable`/
//     `error`; the loop continues either way. When the main process itself
//     dies, the session stops calling into a dead app (every further
//     Playwright call would only reject with "Target closed") and the screens
//     it had not reached yet are re-run against a *fresh* launch. Story 026's
//     per-screen `withApp()` gave that for free; batching must not quietly
//     turn a crash on screen N into twenty-six unvisited screens (AC5).
//  4. **Fixture freshness.** Each session rewrites its variant's fixture before
//     launching (and again before every cold-start launch), so run N+1 cannot
//     inherit run N's drift — the `lastRoute`/`scanOnFirstRun` writes the app
//     makes during a run are erased rather than carried forward (AC6).
//
// The classification shapes below are deliberately the ones story 026 already
// wrote to disk (`shootOne()` in shot.mjs, `auditOne()` in a11y.mjs), so
// `run.json` and `a11y.json` keep their existing schema.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFixture } from './fixture.mjs'
import { HarnessError, resize, withApp } from './harness.mjs'
import { REPO_ROOT, UI_VERIFY_ROOT } from './paths.mjs'

/** Where `capture.shot` writes its PNGs. Exported so the stale sweep agrees with the driver. */
export const SCREENSHOTS_DIR = join(UI_VERIFY_ROOT, 'screenshots')

const AXE_SOURCE_PATH = join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js')

/** The route every visit is reset to before its `navigate()` runs (TitleBar.tsx). */
const BASE_ROUTE_TESTID = 'nav-home'

/**
 * Generous enough for a re-render after a route change, short enough that a
 * genuinely stuck app fails the visit instead of the run. Mirrors
 * `screens.mjs`'s own `CLICK_TIMEOUT_MS` order of magnitude.
 */
const RESET_TIMEOUT_MS = 10_000

/** `run.json` / `a11y.json` key for one visit — unchanged from story 026. */
export function visitKey(screenId, viewport) {
  return `${screenId}@${viewport.width}x${viewport.height}`
}

/** Screenshot filename for one visit — unchanged from story 026's `shot.mjs`. */
export function screenshotFilename(screenId, viewport) {
  return `${screenId}@${viewport.width}x${viewport.height}.png`
}

/** `screens x viewports`, in registry order — the same enumeration story 026's two loops used. */
function expandVisits(screens) {
  const visits = []
  for (const screen of screens) {
    for (const viewport of screen.viewports) visits.push({ screen, viewport })
  }
  return visits
}

/**
 * Puts the app back into the state every registry `navigate()` is written
 * against: default route, no dialog, module views freshly mounted.
 *
 * Routing home is enough to reset a module's own state because
 * `AppShell.resolveView()` returns a *different element type* per route
 * (components/shell/AppShell.tsx), so leaving `/config` unmounts `ConfigView`
 * and re-entering it remounts it with `screen: 'list'`, `activeTab: 'overview'`
 * and no open editor — exactly what a relaunch used to buy.
 *
 * The dialog is closed first and separately: `Modal` (components/ui/Modal.tsx)
 * portals a `fixed inset-0` scrim over everything including the title bar, so a
 * dialog left open by the previous visit (`keybind-dialog`) would intercept the
 * nav click below. Escape is `Modal`'s documented close path, and the store's
 * own dialogs (`Dialogs.tsx`) survive a route change, so this cannot be folded
 * into the click.
 */
async function resetToBaseState(page) {
  try {
    await routeHome(page)
    return
  } catch (error) {
    // Some states no click can leave. A render error trips App.tsx's
    // `ErrorBoundary`, which replaces `AppShell` — title bar included — with a
    // fallback for the rest of the document's life; `config-raw` does exactly
    // that today. Without this branch the first such screen would take every
    // screen after it down with it and report twelve false `unreachable`s,
    // which is precisely the regression a batched session invites. Reloading
    // the document remounts the whole React tree: the isolation a relaunch used
    // to buy, without a new process, a new window or stolen focus.
    try {
      await page.reload({ timeout: RESET_TIMEOUT_MS })
      await page.waitForLoadState('domcontentloaded')
      await routeHome(page)
    } catch (retryError) {
      throw new HarnessError(
        `could not restore the base state: ${messageText(error)}\n` +
          `  reloading the renderer did not help either: ${messageText(retryError)}`,
      )
    }
  }
}

/** Escape any dialog, then route home. Fails if the shell is not there to click. */
async function routeHome(page) {
  const dialogs = page.getByRole('dialog')
  if ((await dialogs.count()) > 0) {
    await page.keyboard.press('Escape')
    await dialogs.first().waitFor({ state: 'hidden', timeout: RESET_TIMEOUT_MS })
  }

  await page.getByTestId(BASE_ROUTE_TESTID).click({ timeout: RESET_TIMEOUT_MS })
  // `aria-current="page"` is set by TitleBar's NavItem for the active route, so
  // this waits for the store to have actually switched rather than for the
  // click to have landed.
  await page.waitForSelector(`[data-testid="${BASE_ROUTE_TESTID}"][aria-current="page"]`, {
    timeout: RESET_TIMEOUT_MS,
  })
}

/**
 * Injects axe-core once per page. The batched session never reloads the
 * document, so `window.axe` survives from one visit to the next and re-parsing
 * half a megabyte of script per screen would be pure waste.
 */
async function ensureAxe(page, axeSource) {
  const present = await page.evaluate(() => typeof window.axe !== 'undefined')
  if (!present) await page.evaluate(axeSource)
}

/** Trims a violation down to what a report needs — verbatim from story 026's `a11y.mjs`. */
function summarizeViolation(violation) {
  const nodes = violation.nodes ?? []
  const example = nodes[0]
  return {
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodeCount: nodes.length,
    exampleTarget: example?.target ?? null,
    exampleHtml: example?.html ?? null,
  }
}

function messageText(error) {
  if (error instanceof HarnessError) return error.message
  return String(error?.message ?? error)
}

/**
 * One visit's result, in the shape both report writers consume.
 *
 * `shot` is `run.json`'s entry for this key and `axe` is `a11y.json`'s; either
 * is `null` when that capture was not requested. `written` / `harnessOk` are
 * the two booleans story 026's callers derived from those records (the
 * stale-PNG sweep and the a11y exit code respectively), kept here so they can
 * never disagree with the records they summarize.
 */
function visitResult({ screen, viewport, shot, axe, written, harnessOk }) {
  return {
    key: visitKey(screen.id, viewport),
    screenId: screen.id,
    variant: screen.variant,
    viewport,
    coldStart: screen.coldStart === true,
    filename: screenshotFilename(screen.id, viewport),
    written,
    harnessOk,
    shot,
    axe,
  }
}

/** Reached the screen, but the app itself misbehaved or never got there. */
function unreachableResult({ screen, viewport, capture, reason, consoleErrors, pageErrors }) {
  return visitResult({
    screen,
    viewport,
    written: false,
    harnessOk: false,
    // Story 026's `shootOne()` recorded the console/page errors it had observed
    // alongside the unreachability; `auditOne()` recorded only the reason.
    shot: capture.shot ? { status: 'unreachable', consoleErrors, pageErrors, reason } : null,
    axe: capture.axe ? { status: 'unreachable', reason, violations: [] } : null,
  })
}

/**
 * The harness/app failed around this visit rather than inside it (launch
 * refused, main process already gone) — nothing was captured. Mirrors the outer
 * `catch` of story 026's `shootOne()`/`auditOne()`.
 */
function harnessFailureResult({ screen, viewport, capture, reason }) {
  return visitResult({
    screen,
    viewport,
    written: false,
    harnessOk: false,
    shot: capture.shot ? { status: 'error', consoleErrors: [], pageErrors: [], reason } : null,
    axe: capture.axe ? { status: 'error', reason, violations: [] } : null,
  })
}

/**
 * Visits one screen at one viewport on an already-running app and never throws:
 * every failure mode becomes a classified result so the caller can keep going.
 *
 * Order is reset → resize → navigate → screenshot → axe. The resize sits before
 * `navigate()` because that is where story 026 had it (the launch-time resize
 * in `withApp`), so a responsive layout cannot hide a testid at one size and
 * not the other; the screenshot and the axe run sit back to back afterwards
 * with nothing in between, which is the whole point of the unified driver.
 */
async function runVisit({ app, page, log, screen, viewport, capture, axeSource }) {
  const consoleFrom = log.messages.length
  const pageErrorsFrom = log.pageErrors.length
  /**
   * Only what happened during *this* visit. A console message emitted by the
   * previous screen but delivered late can still land here — the round trip in
   * `settle()` below is what keeps that window small.
   */
  const observed = () => ({
    consoleErrors: log.messages
      .slice(consoleFrom)
      .filter((message) => message.type === 'error')
      .map((message) => message.text),
    pageErrors: log.pageErrors.slice(pageErrorsFrom),
  })

  try {
    await resetToBaseState(page)
    await resize(app, viewport)
    await screen.navigate(page)
  } catch (error) {
    return unreachableResult({
      screen,
      viewport,
      capture,
      reason: messageText(error),
      ...observed(),
    })
  }

  let shot = null
  let written = false
  let shotError = null
  if (capture.shot) {
    try {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true })
      await page.screenshot({
        path: join(SCREENSHOTS_DIR, screenshotFilename(screen.id, viewport)),
      })
      written = true
    } catch (error) {
      shotError = messageText(error)
    }
  }

  let axeResults = null
  let axeError = null
  if (capture.axe) {
    try {
      await ensureAxe(page, axeSource)
      axeResults = await page.evaluate(async () => await window.axe.run())
      // This function must never throw — a visit that escaped would abort the
      // rest of the session's screens, which is exactly the guarantee above.
      // An axe result without a violations array is therefore this one visit's
      // `error`, not the loop's problem.
      if (!Array.isArray(axeResults?.violations)) {
        throw new Error(`axe.run() returned no violations array (got ${typeof axeResults})`)
      }
    } catch (error) {
      axeError = messageText(error)
    }
  }

  // One protocol round trip before reading the log: console messages are
  // delivered over the same channel as this call, so anything the page logged
  // while it was being captured is in `log` by the time this resolves.
  await page.evaluate(() => true).catch(() => {})

  const { consoleErrors, pageErrors } = observed()
  const appFailed = consoleErrors.length > 0 || pageErrors.length > 0 || log.mainCrashed

  if (capture.shot) {
    shot = shotError
      ? { status: 'error', consoleErrors, pageErrors, reason: shotError }
      : { status: appFailed ? 'error' : 'written', consoleErrors, pageErrors }
  }

  let axe = null
  if (capture.axe) {
    if (axeError) {
      axe = { status: 'error', reason: axeError, consoleErrors, pageErrors, violations: [] }
    } else if (appFailed) {
      axe = {
        status: 'error',
        reason: 'renderer console error/exception or main-process crash during axe run',
        consoleErrors,
        pageErrors,
        violations: (axeResults?.violations ?? []).map(summarizeViolation),
      }
    } else {
      axe = {
        status: 'audited',
        violations: (axeResults?.violations ?? []).map(summarizeViolation),
      }
    }
  }

  return visitResult({
    screen,
    viewport,
    shot,
    axe,
    written,
    harnessOk: !appFailed && !shotError && !axeError,
  })
}

/**
 * Runs every visit of `visits` against one already-running app, appending to
 * `results`, and returns the visits it did *not* attempt.
 *
 * It stops as soon as the main process is gone: every further Playwright call
 * against a dead app would only reject with "Target closed", which says nothing
 * useful about the screen it would be blamed on. The unattempted tail is handed
 * back rather than marked failed, because `runVariantSession` owes those screens
 * a fresh app — the crashing screen keeps its own verdict, the ones behind it
 * are still owed a real visit (AC5).
 */
async function runVisits({ app, page, log, visits, capture, axeSource, results }) {
  for (const [index, { screen, viewport }] of visits.entries()) {
    if (log.mainCrashed || !(await appIsAlive(app))) return visits.slice(index)
    results.push(await runVisit({ app, page, log, screen, viewport, capture, axeSource }))
  }
  return []
}

/**
 * Asks the main process whether it is still there, rather than waiting for
 * `log.mainCrashed` to say so.
 *
 * That flag only flips once Node has reaped the child and delivered `exit`,
 * which is several milliseconds *after* Playwright starts rejecting with
 * "Target closed" — long enough for every remaining screen to run against the
 * corpse, fail, and be blamed for a crash it did not cause. One round trip per
 * visit buys the difference between "not visited because the app is dead" and
 * six false `unreachable`s (AC5); a visit that gets this far already pays
 * several such round trips.
 */
async function appIsAlive(app) {
  try {
    await app.evaluate(() => true)
    return true
  } catch {
    return false
  }
}

/**
 * Records the visits a failed `withApp()` never produced a result for, skipping
 * anything already classified or queued for a relaunch (`skipKeys`). Returns how
 * many it had to record — `0` means every visit was accounted for and the error
 * belongs to the session itself, not to a screen.
 */
function fillMissing({ visits, results, capture, error, skipKeys = new Set() }) {
  const seen = new Set(results.map((result) => result.key))
  let filled = 0
  for (const { screen, viewport } of visits) {
    const key = visitKey(screen.id, viewport)
    if (seen.has(key) || skipKeys.has(key)) continue
    results.push(harnessFailureResult({ screen, viewport, capture, reason: messageText(error) }))
    filled += 1
  }
  return filled
}

/**
 * Drives every screen of one fixture variant.
 *
 * - `variant` — the fixture whose userData the app runs against.
 * - `screens` — registry entries; anything belonging to another variant is
 *   ignored, so a caller may hand over the whole (already filtered) registry.
 * - `capture` — `{ shot, axe }`; at least one must be true.
 * - `seedFixture` — rewrite the variant's fixture before each launch. On by
 *   default and only turned off by a caller that has just written it itself;
 *   the fixture must be freshly written per run (AC6), never merely present.
 *
 * Returns `{ variant, launches, results, error }`. `launches` is the real
 * `_electron.launch()` count for this variant: one for the batched session, one
 * per cold-start visit, plus one per relaunch a mid-session crash forced. `error`
 * is a session-level failure no single visit could be blamed for — in practice
 * `withApp()`'s liveness check finding the app dead once every visit it owned
 * had already been captured. It is `null` on a healthy session, and the caller
 * must fail the run on it (exit 1): an app that died at the finish line, or
 * between two visits that each look clean, must not report clean.
 * Results come back in registry order within the
 * variant — a caller assembling `run.json` across variants and wanting story
 * 026's original key order has to merge by registry position, since batching by
 * variant necessarily visits all of one variant's screens before the other's.
 *
 * A screen marked `coldStart: true` gets its own launch *per viewport*: what
 * such a screen is evidence of is the app's boot state, and that state is
 * produced at a particular window size — resizing into it mid-session would
 * show a booted-then-resized window instead. Its fixture is re-seeded first, so
 * the boot it records is a boot from the seed rather than from whatever the
 * batched session persisted.
 */
export async function runVariantSession({ variant, screens, capture, seedFixture = true }) {
  if (!variant) throw new HarnessError('runVariantSession() needs a fixture variant')
  if (!capture?.shot && !capture?.axe) {
    throw new HarnessError('runVariantSession() needs at least one of capture.shot / capture.axe')
  }

  const mine = screens.filter((screen) => screen.variant === variant)
  const batched = expandVisits(mine.filter((screen) => screen.coldStart !== true))
  const cold = expandVisits(mine.filter((screen) => screen.coldStart === true))

  // Read once per variant rather than once per screen (story 026's `auditOne`
  // re-read it 28 times).
  const axeSource = capture.axe ? readFileSync(AXE_SOURCE_PATH, 'utf8') : null

  const results = []
  let launches = 0
  let error = null

  /**
   * One launch's worth of visits. Anything the app's death kept it from
   * attempting comes back to be retried on a fresh app; anything it attempted
   * keeps whatever verdict it earned. A `withApp()` throw that leaves no visit
   * unaccounted for is the session's own failure (the post-run liveness check)
   * and is recorded as such instead of vanishing.
   */
  const runSession = async (visits, launchOptions) => {
    if (seedFixture) writeFixture(variant)
    launches += 1
    let pending = []
    try {
      await withApp(launchOptions, async ({ app, page, log }) => {
        pending = await runVisits({ app, page, log, visits, capture, axeSource, results })
      })
    } catch (sessionError) {
      const skipKeys = new Set(pending.map(({ screen, viewport }) => visitKey(screen.id, viewport)))
      const filled = fillMissing({ visits, results, capture, error: sessionError, skipKeys })
      // Nothing left to pin it on: either the app died after its last visit was
      // captured, or it died between two visits that both look clean in their
      // own records. Story 026 reported both as a failed run (exit 1) because
      // the launch they belonged to owned the crash; the session-level field is
      // where a batched run keeps that.
      if (filled === 0) error = messageText(sessionError)
    }
    return pending
  }

  /**
   * Visits `visits`, relaunching for whatever a crash left unvisited until every
   * one of them has a verdict. Each pass either classifies at least one visit or
   * gives up, so the relaunch count is bounded by the number of visits.
   */
  const drain = async (visits, launchOptions) => {
    let queue = visits
    while (queue.length > 0) {
      const before = results.length
      const pending = await runSession(queue, launchOptions)
      if (pending.length > 0 && results.length === before) {
        // The fresh app died before a single screen of the retry was visited, so
        // another relaunch would loop rather than make progress.
        fillMissing({
          visits: pending,
          results,
          capture,
          error: new HarnessError(
            'the app died again before any of the remaining screens could be visited',
          ),
        })
        return
      }
      queue = pending
    }
  }

  await drain(batched, { variant })
  for (const visit of cold) {
    await drain([visit], { variant, viewport: visit.viewport })
  }

  return { variant, launches, results, error }
}
