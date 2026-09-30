import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { _electron } from 'playwright'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { closeAppOrKill, HarnessError, variantUserDataDir, withApp } from './harness.mjs'
import { REPO_ROOT } from './paths.mjs'

/**
 * Story 101 D4: the harness's `executablePath` route (`launchApp`/`withApp` in `harness.mjs`) lets
 * every UI-verification entry point drive a packaged binary — e.g. a built Linux AppImage — instead
 * of always launching this repo's own dev build via `ensureBuild()` + `out/main/index.js`.
 *
 * `withApp()` takes an injectable `deps` ({ launch, ensureBuild }) precisely so this can be proven
 * without spawning a real Electron process — mirrors the `ReleaseDeps` seam `release.test.mjs`
 * uses for `release.mjs`.
 */

/** Its own throwaway variant so a real run can never collide with this test's userData folder. */
const TEST_VARIANT = '_harness-test-executablepath'

afterAll(() => {
  rmSync(variantUserDataDir(TEST_VARIANT), { recursive: true, force: true })
})

/**
 * A minimal stand-in for Playwright's `ElectronApplication` + its first `Page`, just enough of the
 * surface `launchApp()` calls between a successful launch and the `assertInside()` confinement
 * check on the userData path the app reports back. `reportedUserDataDir` is whatever the fake
 * `electronApp.getPath('userData')` hands back — the exact value `launchApp()` feeds into
 * `assertInside(UI_VERIFY_ROOT, reportedUserDataDir, ...)`.
 */
function makeFakeApp({ reportedUserDataDir }) {
  const page = {
    on: () => {},
    // `installCspViolationListener` refers to `window`/`document`, which do not exist in this Node
    // stub — but `launchApp()`'s own call site already tolerates a failure here
    // (`.catch(() => {})`), so a stub that never actually runs the passed function is faithful.
    evaluate: async () => undefined,
    addInitScript: async () => undefined,
    waitForLoadState: async () => undefined,
  }
  return {
    process: () => ({
      on: () => {},
      stderr: { on: () => {} },
      exitCode: null,
      signalCode: null,
    }),
    firstWindow: async () => page,
    // The one call `launchApp()` makes on `app` (not `page`) before the confinement guard:
    // `app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))`.
    evaluate: async (fn) => fn({ app: { getPath: () => reportedUserDataDir } }),
    close: async () => undefined,
  }
}

describe('an executablePath launch skips ensureBuild and still confines user-data', () => {
  test('ensureBuild is never called, and the launch is given a --user-data-dir inside UI_VERIFY_ROOT', async () => {
    const ensureBuild = vi.fn()
    // The stub only needs to record what it was called with — it is not asked to behave like a
    // real Electron app, so it fails the launch immediately rather than fake the rest of the
    // window/CSP handshake `launchApp()` does after a successful launch.
    const launch = vi.fn(async () => {
      throw new Error('stub launch — this test never expects a real window')
    })

    await expect(
      withApp(
        {
          variant: TEST_VARIANT,
          executablePath: '/fake/packaged/Q2-Launcher.AppImage',
          deps: { launch, ensureBuild },
        },
        async () => {},
      ),
    ).rejects.toThrow()

    // Half 1: no reason to demand a dev build exists to launch someone else's binary.
    expect(ensureBuild).not.toHaveBeenCalled()

    // Half 2: the launch was given the expected --user-data-dir. This is a functional check on the
    // argument the harness *computed*, not a proof that any confinement guard ran — that proof is
    // the separate test below, which depends on the real `assertInside()` actually throwing.
    expect(launch).toHaveBeenCalledTimes(1)
    const [options] = launch.mock.calls[0]
    expect(options.executablePath).toBe('/fake/packaged/Q2-Launcher.AppImage')

    const userDataArg = options.args.find((arg) => arg.startsWith('--user-data-dir='))
    expect(userDataArg).toBeDefined()
    const userDataPath = userDataArg.slice('--user-data-dir='.length)
    expect(userDataPath).toBe(variantUserDataDir(TEST_VARIANT))

    // A packaged-app launch must not still be pointed at the dev entry point.
    expect(options.args.some((arg) => arg.includes('out') && arg.includes('index.js'))).toBe(false)
  })

  test('a userData path the app reports outside UI_VERIFY_ROOT is rejected by the real assertInside guard', async () => {
    // Deliberately outside `.ui-verify/` (UI_VERIFY_ROOT), not merely a different string — this is
    // the exact shape `assertInside(UI_VERIFY_ROOT, reportedUserDataDir, ...)` in `harness.mjs`
    // (around its post-launch confinement check) must refuse. Unlike the test above, nothing here
    // re-derives or duplicates that check: the fake app just hands back a bad path, and the
    // assertion is that the real production call chain rejects because of it. Deleting that guard
    // from `launchApp()` would make this test hang/fail differently (it would instead fail, if at
    // all, on the unrelated CSP/origin checks that run after it) rather than on this containment
    // message — so this test only passes while the real guard is in place and firing.
    const outsideUserDataDir = join(REPO_ROOT, 'not-ui-verify-userdata')
    const ensureBuild = vi.fn()
    const launch = vi.fn(async () => makeFakeApp({ reportedUserDataDir: outsideUserDataDir }))

    await expect(
      withApp(
        {
          variant: TEST_VARIANT,
          executablePath: '/fake/packaged/Q2-Launcher.AppImage',
          deps: { launch, ensureBuild },
        },
        async () => {},
      ),
    ).rejects.toThrow(/must be inside/)

    expect(launch).toHaveBeenCalledTimes(1)
  })
})

describe('the default launch dependency every real run uses', () => {
  test('Playwright’s launch is called on `_electron` itself, not on the deps object holding it', async () => {
    // The `deps` seam above means every other test in this file injects its own `launch` - so the
    // default the entire UI-verification harness actually runs with (`defaultDeps()` in
    // `harness.mjs`) is the one code path no test exercised. Storing `_electron.launch` there as a
    // bare reference calls Playwright's prototype method with `this === deps`, and its first line
    // reads `this._playwright.selectors`: every flow, screenshot and a11y run dies with "Cannot
    // read properties of undefined (reading 'selectors')" before Electron is even spawned.
    //
    // Proven by receiver, not by spawning: an own-property stub on `_electron` records whatever
    // `this` the harness's default dependency ends up calling it with. A real launch cannot stand
    // in here - Playwright reports a binary that fails to start by throwing inside its own async
    // machinery, which would take the test process down with it.
    const receivers = []
    const outsideUserDataDir = join(REPO_ROOT, 'not-ui-verify-userdata')
    const original = Object.getOwnPropertyDescriptor(_electron, 'launch')
    _electron.launch = function stubLaunch() {
      receivers.push(this)
      return Promise.resolve(makeFakeApp({ reportedUserDataDir: outsideUserDataDir }))
    }

    try {
      await expect(
        withApp(
          { variant: TEST_VARIANT, executablePath: '/fake/packaged/Q2-Launcher.AppImage' },
          async () => {},
        ),
      ).rejects.toThrow(/must be inside/)
    } finally {
      if (original) Object.defineProperty(_electron, 'launch', original)
      else delete _electron.launch
    }

    expect(receivers).toHaveLength(1)
    expect(receivers[0]).toBe(_electron)
  })
})

describe('a flow can pass its own extra Electron launch args', () => {
  test('extra launch args are appended after the user-data-dir switch', async () => {
    const ensureBuild = vi.fn()
    const launch = vi.fn(async () => {
      throw new Error('stub launch — this test never expects a real window')
    })

    await expect(
      withApp(
        {
          variant: TEST_VARIANT,
          extraArgs: ['--lang=de-DE'],
          deps: { launch, ensureBuild },
        },
        async () => {},
      ),
    ).rejects.toThrow()

    expect(launch).toHaveBeenCalledTimes(1)
    const [options] = launch.mock.calls[0]
    const userDataIndex = options.args.findIndex((arg) => arg.startsWith('--user-data-dir='))
    expect(userDataIndex).toBeGreaterThanOrEqual(0)
    expect(options.args[options.args.length - 1]).toBe('--lang=de-DE')
    expect(userDataIndex).toBeLessThan(options.args.length - 1)
  })

  test('extra launch args may not override the user-data-dir', async () => {
    const ensureBuild = vi.fn()
    const launch = vi.fn(async () => {
      throw new Error('stub launch — this test never expects a real window')
    })

    await expect(
      withApp(
        {
          variant: TEST_VARIANT,
          extraArgs: ['--user-data-dir=/tmp/evil'],
          deps: { launch, ensureBuild },
        },
        async () => {},
      ),
    ).rejects.toThrow(HarnessError)

    expect(launch).not.toHaveBeenCalled()
  })
})

/**
 * `withApp()`'s teardown used to just `await Promise.race([app.close().catch(() => {}), sleep(...)])`
 * — if `close()` never settled (story 101 D6: the main process re-execs itself during an AppImage
 * self-update, and the *new*, detached process keeps the pipe Playwright's `close()` waits on), the
 * teardown moved on anyway and never killed the process `launchApp()` attached to. That leaves it
 * holding Electron's single-instance lock, which fails every later flow in the same `ui:flows` run.
 *
 * `closeAppOrKill()` is the fix: bounded wait for `close()`, then a hard kill of `child` if it didn't
 * settle in time. Tested directly (not through a full `withApp()` launch) so both branches run in
 * milliseconds — no 15s real timeout, no spawning Electron, just a fake `app.close()` and a `kill`
 * spy standing in for `taskkill`/`SIGKILL`.
 */
describe('closeAppOrKill', () => {
  test('kills the child once app.close() fails to settle within the timeout', async () => {
    const kill = vi.fn(async () => {})
    const app = { close: () => new Promise(() => {}) } // never settles
    const child = { pid: 4321, exitCode: null, signalCode: null }

    await closeAppOrKill(app, child, { timeoutMs: 20, kill })

    expect(kill).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledWith(child)
  })

  test('does not kill the child when app.close() settles before the timeout', async () => {
    const kill = vi.fn(async () => {})
    const app = { close: async () => undefined }
    const child = { pid: 4321, exitCode: null, signalCode: null }

    await closeAppOrKill(app, child, { timeoutMs: 20, kill })

    expect(kill).not.toHaveBeenCalled()
  })

  test('a close() that rejects still counts as settled, and does not trigger a kill', async () => {
    // `app.close()` rejecting (as it can for an app already gone) is not the same failure as a
    // close that never settles at all — the pre-existing `.catch(() => {})` on `app.close()`
    // already treated a rejection as "done", and this must keep doing so.
    const kill = vi.fn(async () => {})
    const app = { close: async () => Promise.reject(new Error('already closed')) }
    const child = { pid: 4321, exitCode: null, signalCode: null }

    await closeAppOrKill(app, child, { timeoutMs: 20, kill })

    expect(kill).not.toHaveBeenCalled()
  })
})

describe('a dev-build launch (no executablePath) still requires the build to exist', () => {
  test('ensureBuild is called, and the dev entry point is in the launch args', async () => {
    // The mirror case of the `executablePath` route above: today's unchanged behavior is that a
    // launch with no `executablePath` demands a build via `ensureBuild()` and points Electron at
    // this repo's own `out/main/index.js` rather than a packaged binary.
    const ensureBuild = vi.fn()
    const launch = vi.fn(async () => {
      throw new Error('stub launch — this test never expects a real window')
    })

    await expect(
      withApp(
        {
          variant: TEST_VARIANT,
          deps: { launch, ensureBuild },
        },
        async () => {},
      ),
    ).rejects.toThrow()

    expect(ensureBuild).toHaveBeenCalledTimes(1)

    expect(launch).toHaveBeenCalledTimes(1)
    const [options] = launch.mock.calls[0]
    expect(options.executablePath).toBeUndefined()
    expect(options.args.some((arg) => arg.includes('out') && arg.includes('index.js'))).toBe(true)

    const userDataArg = options.args.find((arg) => arg.startsWith('--user-data-dir='))
    expect(userDataArg).toBeDefined()
    expect(userDataArg.slice('--user-data-dir='.length)).toBe(variantUserDataDir(TEST_VARIANT))
  })
})
