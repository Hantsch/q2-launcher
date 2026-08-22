// Starts the *built* app under Playwright's Electron driver and hands the first
// window to a callback. Every UI-verification script goes through `withApp()`.
//
// Four things this file exists to get right — each of them has bitten this repo
// or is documented in docs/requirements/026-ui-verification-harness.md:
//
//  1. `ELECTRON_RUN_AS_NODE` is deleted from the child environment. The repo is
//     often developed from a terminal inside an Electron-hosted editor, which
//     exports it; inherited, `electron.exe` boots as plain Node and the main
//     process dies on its first `require('electron')`.
//  2. The app runs against its own `--user-data-dir` under `.ui-verify/`, and we
//     refuse to launch — and refuse to keep running — unless the userData path
//     Electron actually reports lies inside it. `stateFilePath()` derives from
//     `app.getPath('userData')` (src/main/lib/paths.ts), so that one switch is
//     what keeps a run away from the developer's real state.json. It also gives
//     the run its own single-instance lock, so a real launcher may stay open.
//  3. A missing build produces one sentence, not a Playwright timeout.
//  4. Renderer console output, uncaught renderer exceptions and an abnormal
//     main-process exit are collected instead of swallowed, kept apart so a
//     caller can decide which of them fails a run.
//
// Run directly (`node scripts/lib/harness.mjs`) for a self-check.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { assertInside, HarnessError, REPO_ROOT, UI_VERIFY_ROOT } from './paths.mjs'

export { HarnessError }

const MAIN_ENTRY = join('out', 'main', 'index.js')
const RENDERER_ENTRY = join('out', 'renderer', 'index.html')

/**
 * Mirrors `RENDERER_ORIGIN` from `src/main/lib/renderer-source.ts` (story 035, D1). Duplicated
 * as a literal rather than imported because this file is plain `.mjs` run directly by `node`,
 * with no TypeScript loader in the chain that would let it import a `.ts` module.
 */
const EXPECTED_RENDERER_ORIGIN = 'q2launcher://app'

/** Every production response must carry this — story 035's whole point is that it's not optional. */
const REQUIRED_CSP_DIRECTIVE = "script-src 'self'"

const LAUNCH_TIMEOUT_MS = 60_000
/** Enough of the main process's stderr to explain a launch that died early. */
const STDERR_LINE_LIMIT = 40

/** userData for a fixture variant. D2 seeds these; D1 only launches into them. */
export function variantUserDataDir(variant) {
  return join(UI_VERIFY_ROOT, 'fixture', variant, 'userdata')
}

/**
 * A friendly message instead of a Playwright stack trace when nobody built the
 * app. Checks both entries because a stale `out/` with only main built still
 * starts and then shows a blank window.
 */
export function ensureBuild() {
  const missing = [MAIN_ENTRY, RENDERER_ENTRY].filter(
    (entry) => !existsSync(join(REPO_ROOT, entry)),
  )
  if (missing.length === 0) return
  throw new HarnessError(`build missing (${missing.join(', ')}) — build first: npm run build`)
}

/**
 * Everything a run observed. Console errors and warnings are kept apart on
 * purpose: warnings are evidence, errors fail a run (story 026, exit codes).
 */
export class RunLog {
  /** `{ type, text, location }` for every renderer console message. */
  messages = []
  /** Uncaught renderer exceptions (`pageerror`), which never reach `console`. */
  pageErrors = []
  /** `{ code, signal, expected }` once the main process is gone. */
  mainExit = null
  /** Tail of the main process's stderr — the only clue when it dies pre-window. */
  mainStderr = []

  get errors() {
    return this.messages.filter((message) => message.type === 'error')
  }

  get warnings() {
    return this.messages.filter((message) => message.type === 'warning')
  }

  /** The main process went away without us asking, or with a non-zero code. */
  get mainCrashed() {
    if (!this.mainExit) return false
    return !this.mainExit.expected || (this.mainExit.code ?? 0) !== 0
  }

  /** Everything a caller should treat as "this run failed", as plain lines. */
  get failures() {
    const failures = []
    for (const message of this.errors) failures.push(`console error: ${message.text}`)
    for (const error of this.pageErrors) failures.push(`renderer exception: ${error}`)
    if (this.mainCrashed) failures.push(`main process ${describeExit(this.mainExit)}`)
    return failures
  }

  /** Human-readable dump: counts plus the messages themselves. */
  format() {
    const lines = [
      `console: ${this.errors.length} error(s), ${this.warnings.length} warning(s), ` +
        `${this.messages.length} message(s) total`,
    ]
    for (const message of this.messages) {
      lines.push(
        `  [${message.type}] ${message.text}${message.location ? ` (${message.location})` : ''}`,
      )
    }
    for (const error of this.pageErrors) lines.push(`  [pageerror] ${error}`)
    if (this.mainExit) lines.push(`  [main] ${describeExit(this.mainExit)}`)
    for (const line of this.mainStderr) lines.push(`  [main stderr] ${line}`)
    return lines.join('\n')
  }
}

function describeExit({ code, signal, expected }) {
  const how = signal ? `signal ${signal}` : `code ${code}`
  return `exited with ${how}${expected ? '' : ' before the run finished'}`
}

/**
 * A copy of `process.env` without `ELECTRON_RUN_AS_NODE`.
 *
 * Passing `ELECTRON_RUN_AS_NODE: undefined` inside an env object does *not*
 * reliably unset the variable for a child process, so the key is really removed
 * from a plain object copy. The loop catches variant spellings: Windows
 * environment names are case-insensitive, but `Object.keys` returns whatever
 * casing the parent happened to set, and `delete` is case-sensitive.
 */
export function childEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE' || key.toUpperCase() === 'ELECTRON_RENDERER_URL') {
      delete env[key]
    }
  }
  // Lets the app (and future assertions) tell a UI-verification run apart
  // from a normal launch.
  env.Q2L_UI_HARNESS = '1'
  return env
}

/**
 * Launches the built app, waits for the first window and returns
 * `{ app, page, log, userDataDir }`. Callers use `withApp()`; this is separate
 * only so the failure paths can close what they opened.
 */
async function launchApp({ userDataDir }) {
  ensureBuild()

  // Guard before anything is created: a run must never be able to point Electron
  // at %APPDATA% or at the repo itself.
  const resolvedUserDataDir = assertInside(UI_VERIFY_ROOT, userDataDir, '--user-data-dir')
  mkdirSync(resolvedUserDataDir, { recursive: true })

  const log = new RunLog()
  const state = { expectedExit: false }

  let app
  try {
    app = await _electron.launch({
      args: [join(REPO_ROOT, MAIN_ENTRY), `--user-data-dir=${resolvedUserDataDir}`],
      cwd: REPO_ROOT,
      env: childEnv(),
      timeout: LAUNCH_TIMEOUT_MS,
    })
  } catch (error) {
    // A main process that dies during startup never reaches the listeners below,
    // so its output has to be read back out of Playwright's call log.
    throw new HarnessError(`the app did not start — ${summarizeLaunchError(error)}`, {
      cause: error,
    })
  }

  const child = app.process()
  child.on('exit', (code, signal) => {
    log.mainExit = { code, signal, expected: state.expectedExit }
  })
  child.stderr?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim() !== '' && log.mainStderr.length < STDERR_LINE_LIMIT) log.mainStderr.push(line)
    }
  })

  try {
    const page = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS })

    page.on('console', (message) => {
      const location = message.location()
      log.messages.push({
        type: message.type(),
        text: message.text(),
        location: location?.url ? `${location.url}:${location.lineNumber}` : '',
      })
    })
    page.on('pageerror', (error) => log.pageErrors.push(error.stack || String(error)))

    await page.waitForLoadState('domcontentloaded')

    // Isolation is only real if Electron honoured the switch — ask the app itself
    // rather than trusting the argument we passed.
    const reportedUserDataDir = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData'),
    )
    assertInside(UI_VERIFY_ROOT, reportedUserDataDir, 'userData reported by the app')

    // Production mode is a guarantee, not a coincidence (story 035): the renderer must be
    // served from the app's own privileged scheme, and every response for it must carry the
    // enforced CSP. Read both out of the live page rather than assuming the wiring worked.
    const rendererCheck = await page.evaluate(async () => {
      const response = await fetch(location.href)
      return {
        origin: location.origin,
        csp: response.headers.get('content-security-policy'),
      }
    })
    if (rendererCheck.origin !== EXPECTED_RENDERER_ORIGIN) {
      throw new HarnessError(
        `renderer origin must be ${EXPECTED_RENDERER_ORIGIN}, got ${rendererCheck.origin} — ` +
          'production mode did not load from the q2launcher:// scheme',
      )
    }
    if (!rendererCheck.csp || !rendererCheck.csp.includes(REQUIRED_CSP_DIRECTIVE)) {
      throw new HarnessError(
        `renderer response is missing the required Content-Security-Policy directive ` +
          `${REQUIRED_CSP_DIRECTIVE} — got ${rendererCheck.csp ? `"${rendererCheck.csp}"` : '(no header)'}`,
      )
    }

    return { app, page, log, state, child, userDataDir: reportedUserDataDir }
  } catch (error) {
    state.expectedExit = true
    await app.close().catch(() => {})
    throw enrichLaunchFailure(error, log)
  }
}

/**
 * Pulls the main process's own output out of a Playwright launch error, whose
 * message is a call log with the child's stdio in `[pid=…][err]` lines.
 */
function summarizeLaunchError(error) {
  const lines = String(error.message)
    // Playwright dims the call log with ANSI codes.
    .replace(/\[\d+m/g, '')
    .split('\n')
    .map((line) => line.trim())
  const output = lines
    .filter(
      (line) => /\[(err|out)\]/.test(line) && !/Debugger (listening|ending)|nodejs\.org/.test(line),
    )
    .slice(-6)
  const detail = output.length > 0 ? `main process output:\n  ${output.join('\n  ')}` : lines[0]
  return `${detail}\n  (the main process exited before Playwright could attach)`
}

/**
 * Turns "Timeout 60000ms exceeded" into something that names the likely cause.
 * The classic one is a main process that died before opening a window.
 */
function enrichLaunchFailure(error, log) {
  if (error instanceof HarnessError) return error
  const context = [
    log.mainExit ? `main process ${describeExit(log.mainExit)}` : null,
    log.mainStderr.length > 0 ? `stderr:\n${log.mainStderr.join('\n')}` : null,
  ].filter(Boolean)
  if (context.length === 0) return error
  return new HarnessError(`the app did not open a window — ${context.join('; ')}`, { cause: error })
}

/**
 * Runs `fn` against the built app and closes the app afterwards, whatever
 * happened. `fn` receives `{ app, page, log, userDataDir }` and its result is
 * returned.
 *
 * `variant` names the fixture whose userData the app is launched with
 * (`.ui-verify/fixture/<variant>/userdata`), `viewport` is `{ width, height }`
 * applied through `win.setSize` — a BrowserWindow ignores
 * `page.setViewportSize()`.
 */
export async function withApp({ variant, viewport } = {}, fn) {
  if (!variant) throw new HarnessError('withApp() needs a fixture variant')

  const { app, page, log, state, child, userDataDir } = await launchApp({
    userDataDir: variantUserDataDir(variant),
  })

  try {
    if (viewport) await resize(app, viewport)
    const result = await fn({ app, page, log, userDataDir })
    await assertStillRunning(app, child, log, state)
    return result
  } catch (error) {
    await settleExit(child, log, state)
    // A crash makes every Playwright call fail with "Target closed"; report the
    // crash, which is the actual finding, and keep the original as the cause.
    if (log.mainCrashed && !(error instanceof HarnessError)) {
      throw new HarnessError(`main process ${describeExit(log.mainExit)}: ${error.message}`, {
        cause: error,
      })
    }
    throw error
  } finally {
    state.expectedExit = true
    await app.close().catch(() => {})
  }
}

/**
 * Did the app survive `fn`? The main process is *asked*, not inferred from the
 * `exit` event: that event can still be in flight when `fn` resolves, and a run
 * whose app died halfway through must not be reported as clean.
 */
async function assertStillRunning(app, child, log, state) {
  if (!log.mainCrashed) {
    try {
      await app.evaluate(() => true)
      return
    } catch (error) {
      await settleExit(child, log, state)
      if (!log.mainExit) {
        throw new HarnessError(
          `the app stopped responding before the run finished: ${error.message}`,
          {
            cause: error,
          },
        )
      }
    }
  }
  throw new HarnessError(`main process ${describeExit(log.mainExit)}`)
}

/**
 * Error path only: a dying main process makes the pending Playwright call reject
 * a moment before the child is reaped, so give the `exit` event that moment.
 * Otherwise a crash is reported as a bare "Target closed".
 */
async function settleExit(child, log, state, timeoutMs = 1000) {
  if (log.mainExit) return
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((done) => {
      const timer = setTimeout(done, timeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        done()
      })
    })
  }
  if (!log.mainExit && (child.exitCode !== null || child.signalCode !== null)) {
    log.mainExit = { code: child.exitCode, signal: child.signalCode, expected: state.expectedExit }
  }
}

/**
 * Resizes the app's single window. Callable more than once per launch — it
 * only touches the already-running app, it never relaunches.
 */
export async function resize(app, { width, height }) {
  await app.evaluate(
    async ({ BrowserWindow }, size) => {
      const [window] = BrowserWindow.getAllWindows()
      if (!window) throw new Error('no BrowserWindow to resize')
      // A restored-maximized window would ignore setSize.
      if (window.isMaximized()) window.unmaximize()
      window.setSize(size.width, size.height)
      window.center()
    },
    { width, height },
  )
}

// --- self-check -------------------------------------------------------------

/** Its own throwaway variant, so it can never collide with a real fixture. */
const SELF_CHECK_VARIANT = '_selfcheck'

async function selfCheck() {
  console.log('harness self-check')
  console.log(`  repo root      ${REPO_ROOT}`)
  console.log(`  output root    ${UI_VERIFY_ROOT}`)
  console.log(
    `  ELECTRON_RUN_AS_NODE in this shell: ${process.env.ELECTRON_RUN_AS_NODE ?? '(unset)'}` +
      `, in the child: ${childEnv().ELECTRON_RUN_AS_NODE ?? '(unset)'}`,
  )

  ensureBuild()

  // Throwaway means throwaway: start from an empty userData dir every time.
  rmSync(variantUserDataDir(SELF_CHECK_VARIANT), { recursive: true, force: true })

  const observed = await withApp(
    { variant: SELF_CHECK_VARIANT, viewport: { width: 1280, height: 800 } },
    async ({ page, log, userDataDir }) => {
      await page.waitForSelector('#root', { timeout: 15_000 })
      const size = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }))
      return { userDataDir, size, log }
    },
  )

  console.log(`  userData       ${observed.userDataDir}`)
  console.log(`  window         ${observed.size.width}x${observed.size.height}`)
  console.log(observed.log.format())

  const failures = observed.log.failures
  if (failures.length > 0) {
    console.error(`self-check FAILED: ${failures.length} finding(s)`)
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }

  console.log('self-check OK')
  return 0
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  const self = fileURLToPath(import.meta.url)
  return process.platform === 'win32'
    ? resolve(entry).toLowerCase() === self.toLowerCase()
    : resolve(entry) === self
}

if (isDirectRun()) {
  try {
    process.exitCode = await selfCheck()
  } catch (error) {
    // Expected failures (no build, containment guard, dead main process) print
    // their sentence; anything else is a bug and keeps its stack.
    if (error instanceof HarnessError) {
      console.error(`self-check FAILED: ${error.message}`)
      // Only the headline of the cause: a Playwright call log is pages long.
      if (error.cause) console.error(`  cause: ${String(error.cause.message).split('\n')[0]}`)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  }
}
