import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { variantUserDataDir, withApp } from './harness.mjs'
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
