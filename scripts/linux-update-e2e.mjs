// Story 101 D6 (docs/requirements/101-a-linux-release-ships-and-updates-itself.md): AC6's e2e -
// "a packaged AppImage takes an update on its startup check and comes back as the new version".
// Linux only, and only ever run by `.github/workflows/linux-update.yml`; there is no way to
// rehearse it on Windows (the story's own Locality note).
//
// ## What it actually proves, and why it needs an out-of-process oracle
//
// Everything before the restart is observed through the real app: the startup check fires on its
// own (a fresh `--user-data-dir` means `lastSuccessAt` is null, which
// `src/main/services/update/service.ts`'s `isWindowOpen()` reads as "due", so the daily check AC6
// names runs without anything faking a timer), the offer is taken with the real titlebar control
// (`nav-update` -> `update-popover-download` -> `update-popover-restart`, the same testids
// `scripts/flows/app-update.mjs` drives), and the download/install go through the real
// `update:download` / `update:installAndRestart` IPC channels behind those buttons.
//
// The restart is where in-process observation stops being possible. `electron-updater` picks its
// `AppImageUpdater` on Linux, whose `doInstall()` unlinks `$APPIMAGE`, moves the downloaded file
// next to it and spawns *that* - a brand new detached process the Playwright driver was never
// attached to, while the old one quits underneath us. So the only honest evidence that the new
// build came back up is written by the new build itself: the boot line `src/main/index.ts` logs
// (`Q2 Launcher <version> starting on <platform>`), which this script polls out of the log file on
// disk. Nothing this script asserts is true before the update: the string it waits for contains the
// bumped version, which no process in this run can print until the relaunch has happened.
//
// ## Why the oracle's path is knowable at all
//
// `AppImageUpdater.doInstall()` spawns the new AppImage with *no arguments* and the old process's
// environment, so the relaunched launcher does NOT inherit `--user-data-dir` - it lands on
// Electron's default `userData`, i.e. `$XDG_CONFIG_HOME/<app name>`. That is why the old app is
// launched with `XDG_CONFIG_HOME` pointed inside `.ui-verify/`: it makes the relaunched process's
// log path deterministic *and* keeps it from writing into the runner's real `~/.config`. The value
// is read back out of the running app (`app.getPath('appData')`) rather than assumed - if the
// override did not take, this script says so instead of polling a path nothing writes to.
//
// ## The feed
//
// No app code is touched to redirect the update feed and there is no dev shortcut to abuse (there
// is no `dev-app-update.yml` and no `setFeedURL()` call anywhere in this repo - `checker.ts` only
// ever mentions the former in a comment). Instead both builds are packaged against a derived
// electron-builder config whose `publish` block is `{ provider: generic, url:
// http://127.0.0.1:<port>/ }`, which electron-builder writes verbatim into the packaged
// `app-update.yml` - the file `electron-updater` reads at runtime to find its feed. The block is
// *replaced*, not merged over the checked-in `publish:`, because `GenericServerOptions` is
// `additionalProperties: false` in electron-builder's own scheme.json: a leftover `owner`/`repo`
// from the github provider would fail config validation.
//
// Usage: `node scripts/linux-update-e2e.mjs` from the repo root (needs xvfb and libfuse2, see the
// workflow). Exits 0 only once the bumped version has been read back out of the log.
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { writeFixture } from './lib/fixture.mjs'
import { withApp } from './lib/harness.mjs'
import { HarnessError, REPO_ROOT, UI_VERIFY_ROOT } from './lib/paths.mjs'
import { nextVersion } from './lib/release/version.mjs'

/**
 * Reuses the harness's own `empty` fixture variant (`scripts/lib/fixture.mjs`'s
 * `writeEmptyFixture()`, dispatched through `writeFixture()`) rather than a bespoke
 * `linux-update` userData: its `state.json` is `emptyStateDocument()`, which sets
 * `scanOnFirstRun: false` specifically so `useLauncher.bootstrap()` never opens the modal
 * `DetectDialog` with `autoStart: true` - the exact trap that fixture's own doc comment
 * documents (a real Steam/GOG/registry scan the harness must never trigger). Without that seed, a
 * fresh `--user-data-dir` falls back to `DEFAULT_SETTINGS` (`scanOnFirstRun: true`), the dialog's
 * full-viewport scrim intercepts this script's `nav-update` click, and the click times out before
 * ever proving an update happened.
 *
 * It also happens to keep this run's "the startup check is due" precondition
 * (`lastSuccessAt === null`) exactly as before: `writeEmptyFixture()` deletes and rewrites the
 * variant's userData on every call, so there is never a stale `lastSuccessAt` left over from a
 * previous run.
 */
const FIXTURE_VARIANT = 'empty'
/** Distinct from `FIXTURE_VARIANT`: only names this script's own scratch directory
 * (`XDG_CONFIG_HOME`, the derived build config) under `.ui-verify/`, never a fixture userData. */
const VARIANT = 'linux-update'
const WORK_DIR = join(UI_VERIFY_ROOT, 'linux-update')
/** Becomes the relaunched process's `app.getPath('appData')` - see the header. */
const XDG_CONFIG_HOME = join(WORK_DIR, 'xdg-config')
const BUILD_CONFIG_PATH = join(WORK_DIR, 'electron-builder.e2e.yml')
const ELECTRON_BUILDER_CONFIG = join(REPO_ROOT, 'electron-builder.yml')
const PACKAGE_JSON = join(REPO_ROOT, 'package.json')

/** electron-builder resolves `${arch}` to `x86_64` for AppImage targets - see the comment on
 * `linux.artifactName` in electron-builder.yml. */
const APPIMAGE_ARCH = 'x86_64'
const FEED_FILE = 'latest-linux.yml'

const CHECK_TIMEOUT_MS = 180_000
const DOWNLOAD_TIMEOUT_MS = 300_000
const RESTART_TIMEOUT_MS = 60_000
const RELAUNCH_TIMEOUT_MS = 180_000
const UI_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 1_000

function appImageName(version) {
  return `Q2-Launcher-${version}-linux-${APPIMAGE_ARCH}.AppImage`
}

function releaseDir(version) {
  return join(REPO_ROOT, 'release', version)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function log(message) {
  console.log(`[linux-update-e2e] ${message}`)
}

function run(command, args, extraEnv = {}) {
  log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
}

// --- the local update feed ----------------------------------------------------------------------

/**
 * Serves exactly the two files the Linux asset set consists of (`scripts/lib/release/artifacts.mjs`
 * - an AppImage and `latest-linux.yml`, no blockmap) out of the newer build's `release/<version>/`.
 * Anything else, and anything not on disk yet, is a plain 404 - which is the failure path this
 * deliverable is asked to keep honest: without `latest-linux.yml` the check fails with an HTTP
 * error, `waitForOffer()` sees `phase: 'error'` and aborts loudly instead of quietly passing.
 *
 * Single `Range` requests are answered properly (206 + `Content-Range`) because
 * `AppImageUpdater.doDownloadUpdate()` first tries a differential download, which reads the new
 * file's embedded block map through range requests. Multi-range is not implemented and does not
 * need to be: the derived publish config sets `useMultipleRangeRequest: false`.
 */
function startFeedServer(servedVersion) {
  const files = new Map([
    [`/${FEED_FILE}`, join(releaseDir(servedVersion), FEED_FILE)],
    [
      `/${appImageName(servedVersion)}`,
      join(releaseDir(servedVersion), appImageName(servedVersion)),
    ],
  ])

  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    const filePath = files.get(decodeURIComponent(path))
    if (filePath === undefined || !existsSync(filePath)) {
      log(`feed: ${req.method} ${path} -> 404`)
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found\n')
      return
    }

    const { size } = statSync(filePath)
    const range = /^bytes=(\d*)-(\d*)$/.exec((req.headers.range ?? '').trim())
    if (range) {
      let [start, end] = [
        range[1] === '' ? undefined : Number(range[1]),
        range[2] === '' ? undefined : Number(range[2]),
      ]
      if (start === undefined) {
        // A suffix range (`bytes=-N`) asks for the last N bytes - exactly how an embedded block
        // map is read off the tail of an AppImage.
        start = end === undefined ? 0 : Math.max(0, size - end)
        end = size - 1
      }
      if (end === undefined || end > size - 1) end = size - 1
      if (start > end) {
        log(`feed: ${req.method} ${path} range ${req.headers.range} -> 416`)
        res.writeHead(416, { 'Content-Range': `bytes */${size}` })
        res.end()
        return
      }
      log(`feed: ${req.method} ${path} range ${start}-${end}/${size} -> 206`)
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      })
      if (req.method === 'HEAD') return res.end()
      createReadStream(filePath, { start, end }).pipe(res)
      return
    }

    log(`feed: ${req.method} ${path} -> 200 (${size} bytes)`)
    res.writeHead(200, {
      'Content-Type': path.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(filePath).pipe(res)
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port, url: `http://127.0.0.1:${port}/` })
    })
  })
}

// --- the two builds -------------------------------------------------------------------------

/** Copies the checked-in electron-builder config and replaces its whole `publish:` block. */
function writeDerivedBuildConfig(feedUrl) {
  const config = yaml.load(readFileSync(ELECTRON_BUILDER_CONFIG, 'utf8'))
  config.publish = {
    provider: 'generic',
    url: feedUrl,
    // Keeps the differential downloader on single `Range` requests, which the feed server above
    // implements; a multipart/byteranges response is not worth writing for a throwaway feed.
    useMultipleRangeRequest: false,
  }
  mkdirSync(WORK_DIR, { recursive: true })
  writeFileSync(BUILD_CONFIG_PATH, yaml.dump(config), 'utf8')
  log(`derived build config: ${BUILD_CONFIG_PATH} (publish -> generic ${feedUrl})`)
}

/**
 * Packages one AppImage at `version`. The version override is `npm pkg set version=...`, the same
 * technique `.github/workflows/release.yml`'s `build-linux` job already uses and for the same
 * reason: electron-builder reads `package.json`'s `"version"` to pick `directories.output`
 * (`release/<version>`) and to name the artifact. `--publish never` so a configured `publish`
 * block can never turn into an upload attempt; the metadata files (`latest-linux.yml`,
 * `app-update.yml`) are produced regardless - they are gated on `publish` being configured, not on
 * the CLI flag (see electron-builder.yml's own comment).
 */
function packageAt(version) {
  log(`packaging the AppImage at ${version}`)
  run('npm', ['pkg', 'set', `version=${version}`])
  run(
    'node',
    [
      join(REPO_ROOT, 'node_modules', 'electron-builder', 'cli.js'),
      '--linux',
      '--config',
      BUILD_CONFIG_PATH,
      '--publish',
      'never',
    ],
    { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  )

  const built = join(releaseDir(version), appImageName(version))
  if (!existsSync(built)) {
    throw new HarnessError(
      `electron-builder produced no ${appImageName(version)} under ${releaseDir(version)}`,
    )
  }
  chmodSync(built, 0o755)
  return built
}

// --- driving the older build ------------------------------------------------------------------

function invoke(page, channel, payload) {
  return page.evaluate(({ ch, p }) => window.q2.invoke(ch, p), { ch: channel, p: payload })
}

const updateState = (page) => invoke(page, 'update:getState')

/** Waits for the launcher's *own* startup check to report the served release. A check that failed
 * (missing feed file, wrong port, unreachable server) surfaces as `phase: 'error'` with a reason
 * and aborts here rather than burning the whole timeout on a state that can no longer change. */
async function waitForOffer(page, expectedVersion) {
  const deadline = Date.now() + CHECK_TIMEOUT_MS
  let last = null
  while (Date.now() < deadline) {
    last = await updateState(page)
    if (last.error !== null) {
      throw new HarnessError(
        `the startup update check failed (${last.error.key}) - the launcher never saw the served ` +
          `release. Is ${FEED_FILE} on the feed? state: ${JSON.stringify(last)}`,
      )
    }
    if (last.update?.version === expectedVersion) return last
    if (last.update !== null) {
      throw new HarnessError(
        `the startup check offered ${last.update.version}, expected ${expectedVersion}`,
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new HarnessError(
    `the startup update check never offered ${expectedVersion} within ${CHECK_TIMEOUT_MS}ms - ` +
      `last state: ${JSON.stringify(last)}`,
  )
}

async function waitForPhase(page, phase, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await updateState(page)
    if (last.phase === phase) return last
    if (last.phase === 'available' && last.error !== null) {
      throw new HarnessError(`the download ended without a staged release (${last.error.key})`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new HarnessError(
    `the update never reached phase '${phase}' within ${timeoutMs}ms - last state: ${JSON.stringify(last)}`,
  )
}

/** Opens the titlebar popover if it is not already open. Clicking `nav-update` toggles, so a blind
 * second click would close the thing the next step needs. */
async function openUpdatePopover(page) {
  if ((await page.getByTestId('update-popover').count()) > 0) return
  await page.getByTestId('nav-update').click({ timeout: UI_TIMEOUT_MS })
  await page.getByTestId('update-popover').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
}

/**
 * Blocks until the old process is actually gone, so the callback cannot return while
 * `quitAndInstall()` is still on its way through IPC - `withApp()`'s own `finally` closes the app,
 * and closing it before it re-execed itself would kill the very thing this test is here to observe.
 *
 * Two non-gone outcomes are reported rather than thrown, because the caller has already entered the
 * "Playwright's connection is expected to die" window and must not swallow them: a guard refusal
 * (`update:installAndRestart` returning `appUpdate.error.*`, which replaces the button with its
 * reason) and a plain timeout.
 */
async function waitForOldProcessGone(page, app) {
  const deadline = Date.now() + RESTART_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await app.evaluate(() => true)
    } catch {
      return { gone: true, refusal: null }
    }
    const refusals = await page
      .getByTestId('update-popover-refusal')
      .count()
      .catch(() => 0)
    if (refusals > 0) {
      const text = await page
        .getByTestId('update-popover-refusal')
        .innerText()
        .catch(() => '(unreadable)')
      return { gone: false, refusal: text }
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return { gone: false, refusal: null }
}

// --- the oracle -------------------------------------------------------------------------------

function tail(path, lines = 20) {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return '(unreadable)'
  }
}

/**
 * Polls the boot line `src/main/index.ts` writes for the bumped version. `candidates` is ordered
 * most-likely-first but every one of them is checked on every pass: the string carries the version,
 * so a match in any of them can only have been written by the relaunched build.
 */
async function waitForRelaunch(candidates, needle) {
  const deadline = Date.now() + RELAUNCH_TIMEOUT_MS
  while (Date.now() < deadline) {
    for (const path of candidates) {
      if (!existsSync(path)) continue
      if (readFileSync(path, 'utf8').includes(needle)) return path
    }
    await sleep(POLL_INTERVAL_MS)
  }
  const report = candidates
    .map((path) => `  ${path} ${existsSync(path) ? `exists:\n${tail(path)}` : '(does not exist)'}`)
    .join('\n')
  throw new HarnessError(
    `the relaunched launcher never logged "${needle}" within ${RELAUNCH_TIMEOUT_MS}ms.\n${report}`,
  )
}

// --- the run ----------------------------------------------------------------------------------

async function main() {
  if (process.platform !== 'linux') {
    throw new HarnessError(
      `this e2e only runs on Linux (it builds and self-updates a real AppImage); this is ${process.platform}`,
    )
  }

  log(
    'AC6: a packaged AppImage takes an update on its startup check and comes back as the new version',
  )

  const packageJsonText = readFileSync(PACKAGE_JSON, 'utf8')
  const oldVersion = JSON.parse(packageJsonText).version
  const newVersion = nextVersion(oldVersion, 'patch', { explicit: true })
  log(`old build ${oldVersion} -> served release ${newVersion}`)

  rmSync(WORK_DIR, { recursive: true, force: true })
  mkdirSync(XDG_CONFIG_HOME, { recursive: true })

  const { server, url } = await startFeedServer(newVersion)
  log(`feed server listening on ${url} (serving release/${newVersion})`)

  let oldAppImage
  try {
    writeDerivedBuildConfig(url)

    // Built once for both packages: only `package.json`'s version differs between them, and
    // electron-builder copies that file fresh into each `app.asar`.
    run('npm', ['run', 'icon'])
    run('npm', ['run', 'fetch:7za'])
    run('npm', ['run', 'build'])

    packageAt(newVersion)
    oldAppImage = packageAt(oldVersion)
  } finally {
    // Whatever happened, this checkout goes back to the version it arrived with.
    writeFileSync(PACKAGE_JSON, packageJsonText, 'utf8')
  }

  // Fail before launching anything if the feed cannot actually answer: a 404 here is the exact
  // shape of "someone deleted latest-linux.yml", and it must be a loud failure, not a run that
  // limps on to assert something that was already true.
  const feedResponse = await fetch(`${url}${FEED_FILE}`)
  if (!feedResponse.ok) {
    throw new HarnessError(
      `${url}${FEED_FILE} answered ${feedResponse.status} - the feed has no update metadata`,
    )
  }
  const feedBody = await feedResponse.text()
  if (!feedBody.includes(newVersion)) {
    throw new HarnessError(`${FEED_FILE} does not name ${newVersion}:\n${feedBody}`)
  }
  log(`${FEED_FILE} is served and names ${newVersion}`)

  const needle = `Q2 Launcher ${newVersion} starting`
  let logCandidates = []
  let installTriggered = false
  /** Set by `waitForOldProcessGone()`; rethrown below, outside the tolerated-teardown window. */
  let restartProblem = null

  // Seed the fixture immediately before launch, same as every other harness-driven flow
  // (`scripts/lib/session.mjs`'s `runVariantSession()` reseeds before every `withApp()` call) - see
  // the `FIXTURE_VARIANT` comment above for why `empty` specifically is what keeps the DetectDialog
  // out of `nav-update`'s way.
  writeFixture(FIXTURE_VARIANT)

  try {
    await withApp(
      { variant: FIXTURE_VARIANT, executablePath: oldAppImage, env: { XDG_CONFIG_HOME } },
      async ({ page, app }) => {
        const identity = await app.evaluate(({ app: electronApp }) => ({
          name: electronApp.getName(),
          version: electronApp.getVersion(),
          appData: electronApp.getPath('appData'),
          logs: electronApp.getPath('logs'),
        }))
        log(`running build: ${identity.name} ${identity.version} (appData ${identity.appData})`)
        if (identity.version !== oldVersion) {
          throw new HarnessError(
            `expected to launch the ${oldVersion} build, but it reports ${identity.version}`,
          )
        }
        if (identity.appData !== XDG_CONFIG_HOME) {
          throw new HarnessError(
            `XDG_CONFIG_HOME did not take: appData is ${identity.appData}, expected ${XDG_CONFIG_HOME} - ` +
              'the relaunched process would write its log somewhere this run cannot find',
          )
        }
        // Where the *relaunched* process will log (default userData under the overridden
        // XDG_CONFIG_HOME), plus this process's own log dir as a fallback in case a future Electron
        // derives `logs` differently.
        logCandidates = [
          join(identity.appData, identity.name, 'logs', 'main.log'),
          join(identity.logs, 'main.log'),
        ]

        // AC6's "daily check": nothing here asks for it. A fresh userData leaves `lastSuccessAt`
        // null, so `scheduleStartupCheck()` runs a real check a few seconds after first paint.
        const offered = await waitForOffer(page, newVersion)
        log(`the startup check offered ${offered.update.version} (phase ${offered.phase})`)

        await page.getByTestId('nav-update').waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        await openUpdatePopover(page)
        await page.getByTestId('update-popover-download').click({ timeout: UI_TIMEOUT_MS })
        await waitForPhase(page, 'downloaded', DOWNLOAD_TIMEOUT_MS)
        log('the update finished downloading and is staged')

        await openUpdatePopover(page)
        await page
          .getByTestId('update-popover-restart')
          .waitFor({ state: 'visible', timeout: UI_TIMEOUT_MS })
        installTriggered = true
        await page
          .getByTestId('update-popover-restart')
          .click({ timeout: UI_TIMEOUT_MS })
          .catch(() => {
            // The click itself can lose its reply: `quitAndInstall()` tears the process down from
            // under the IPC call it was made through. That is the expected shape here.
          })

        const outcome = await waitForOldProcessGone(page, app)
        if (outcome.gone) {
          log('the old process is gone - the AppImage re-execed itself through $APPIMAGE')
        } else {
          restartProblem =
            outcome.refusal === null
              ? `the launcher was still running ${RESTART_TIMEOUT_MS}ms after "Restart and install" was clicked - nothing restarted`
              : `update:installAndRestart was refused: ${outcome.refusal}`
        }
      },
    )
  } catch (error) {
    // Past `update:installAndRestart` there is nothing left for Playwright to talk to - the
    // AppImage re-execs itself and the old process quits. Only tolerated once the restart was
    // deliberately triggered; before that, every failure is a real one.
    if (!installTriggered) throw error
    log(
      `the app went away after the restart, as expected (${String(error?.message).split('\n')[0]})`,
    )
  }

  if (restartProblem !== null) throw new HarnessError(restartProblem)

  const found = await waitForRelaunch(logCandidates, needle)
  log(`the relaunched launcher logged "${needle}" in ${found}`)

  server.close()
  // Best effort: the relaunched launcher is detached and would otherwise outlive this step.
  try {
    execFileSync('pkill', ['-f', appImageName(newVersion)], { stdio: 'ignore' })
  } catch {
    /* nothing to kill, or no pkill - neither changes the result */
  }

  console.log(
    `linux-update-e2e: a packaged AppImage at ${oldVersion} found the served ${newVersion} release ` +
      'on its own startup check, downloaded and installed it through the real titlebar control, and ' +
      `came back up reporting ${newVersion} (AC6)`,
  )
}

try {
  await main()
  process.exit(0)
} catch (error) {
  if (error instanceof HarnessError) {
    console.error(`linux-update-e2e FAILED: ${error.message}`)
    if (error.cause) console.error(`  cause: ${String(error.cause.message).split('\n')[0]}`)
  } else {
    console.error('linux-update-e2e FAILED:')
    console.error(error)
  }
  process.exit(1)
}
