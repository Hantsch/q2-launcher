// D7 (docs/requirements/026-ui-verification-harness.md): the flow API a
// story's own acceptance steps get scripted on top of, plus its worked
// example (`scripts/flows/open-keycap-dialog.mjs`). Unlike `shot.mjs`/
// `a11y.mjs`, which walk a fixed registry, a flow is free-form: click, type,
// assert, drop extra screenshots — whatever one story's smoke test needs.
//
// Usage: `node scripts/flow.mjs <name>` (or `npm run ui:flow -- <name>`).
// Resolves `scripts/flows/<name>.mjs`, imports its default export and calls it
// with `{ page, app, shot(label), log, step(name) }`. `step()` just records
// the current step name so a thrown error can be reported as
// "flow '<name>' failed at step '<step>': <message>" — the acceptance
// criterion this file exists for.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HarnessError, withApp } from './lib/harness.mjs'
import { REPO_ROOT, UI_VERIFY_ROOT } from './lib/paths.mjs'

/** Mirrors src/shared/constants.ts:17-18 (`WINDOW_DEFAULT_WIDTH/HEIGHT`) — same default the harness self-check and screens.mjs use. */
const VIEWPORT_DEFAULT = { width: 1280, height: 800 }

const FLOWS_SCREENSHOTS_DIR = join(UI_VERIFY_ROOT, 'screenshots', 'flows')

function flowPath(name) {
  return join(REPO_ROOT, 'scripts', 'flows', `${name}.mjs`)
}

async function loadFlow(name) {
  const path = flowPath(name)
  if (!existsSync(path)) {
    throw new HarnessError(`unknown flow '${name}' — expected scripts/flows/${name}.mjs`)
  }
  const mod = await import(pathToFileURL(path).href)
  if (typeof mod.default !== 'function') {
    throw new HarnessError(`scripts/flows/${name}.mjs must have a default export function`)
  }
  return mod
}

/**
 * Story 066 D8: the one flow so far that needs to run against a fixture variant other than
 * `populated` — AC9 ("import from files needs no installation") is only real e2e proof once it is
 * shown on a launcher with zero installations registered at all, i.e. the `empty` fixture variant
 * (`scripts/lib/fixture.mjs`), not merely "the flow never picked one". `variant` defaults to
 * `'populated'`, so every flow that predates this story keeps its exact prior behaviour with no
 * argument needed - only `import-from-files` (and any future flow with the same need) has to pass
 * a second CLI argument. The flow function itself receives `variant` in its own context object
 * (alongside `page`/`app`/`shot`/`log`/`step`), so it can tailor its own steps to whichever fixture
 * it is actually running against, same as `import-from-files.mjs` does.
 *
 * Flows still never reseed their fixture (unlike `ui:shot`/`ui:a11y`/`ui:verify`'s
 * `runVariantSession()`) - a stale non-`populated` fixture needs the same `npm run ui:seed` first
 * that every other flow's own doc comment already asks for.
 *
 * `executablePath` (story 101 D4), when given, drives a packaged binary instead of this repo's own
 * dev build — see `withApp()`'s doc comment in `scripts/lib/harness.mjs`.
 */
async function runFlow(name, requestedVariant, executablePath) {
  const flow = await loadFlow(name)
  // Story 095 D3: a flow that can only run against one fixture variant may name it itself
  // (`export const variant = 'news-cover'`), so `npm run ui:flow -- <name>` is enough and nobody
  // has to remember a second argument for it. An explicit CLI argument still wins, and a flow
  // that exports nothing keeps the original `populated` default - `import-from-files` included.
  const variant = requestedVariant || flow.variant || 'populated'

  let currentStep = null
  const step = (label) => {
    currentStep = label
    console.log(`  step: ${label}`)
  }

  mkdirSync(FLOWS_SCREENSHOTS_DIR, { recursive: true })

  // Story 074 D8: two optional exports a flow may add next to its default one, for the case the
  // `bootstrap-wizard` flow introduced — work that has to happen BEFORE the app is launched and
  // work that has to happen after it is gone, neither of which the flow function itself can do
  // (it only runs while the app is up).
  //
  //   export async function setup({ variant }) -> { env?: { …} }
  //     Runs before `withApp()`. Whatever `env` it returns is merged into the child environment
  //     (see `childEnv()` in `scripts/lib/harness.mjs`) — the only way to hand the app a value the
  //     flow computed moments earlier, e.g. the port a fixture server just bound. Anything else
  //     the flow needs afterwards it keeps in its own module scope; nothing is threaded back.
  //   export async function teardown()
  //     Runs after the app is closed, pass or fail, so a fixture server cannot outlive the run.
  const setupResult = typeof flow.setup === 'function' ? ((await flow.setup({ variant })) ?? {}) : {}

  try {
    await withApp(
      { variant, viewport: VIEWPORT_DEFAULT, env: setupResult.env, executablePath },
      async ({ page, app, log }) => {
        const shot = async (label) => {
          const filePath = join(FLOWS_SCREENSHOTS_DIR, `${name}-${label}.png`)
          await page.screenshot({ path: filePath })
          console.log(`  shot: ${filePath}`)
        }

        try {
          await flow.default({ page, app, shot, log, step, variant })
        } catch (error) {
          const stepInfo = currentStep ? ` at step '${currentStep}'` : ''
          throw new HarnessError(`flow '${name}' failed${stepInfo}: ${error.message}`, {
            cause: error,
          })
        }
      },
    )
  } finally {
    if (typeof flow.teardown === 'function') await flow.teardown()
  }

  return variant
}

/**
 * Splits `--app=<path>` (story 101 D4) out of the raw CLI args, wherever it appears, from the
 * positional `<name> [variant]` — otherwise `--app=...` given after a flow name with no variant
 * would be misread as the variant itself.
 */
function parseCliArgs(argv) {
  let appPath = null
  const positional = []
  for (const arg of argv) {
    if (arg.startsWith('--app=')) appPath = arg.slice('--app='.length)
    else positional.push(arg)
  }
  return { appPath, name: positional[0], requestedVariant: positional[1] }
}

async function main() {
  const { appPath, name, requestedVariant } = parseCliArgs(process.argv.slice(2))
  if (!name) {
    console.error('usage: node scripts/flow.mjs <name> [variant] [--app=<path>]')
    process.exitCode = 1
    return
  }

  try {
    const variant = await runFlow(name, requestedVariant, appPath ?? undefined)
    console.log(`flow '${name}' OK (variant: ${variant})`)
    process.exitCode = 0
  } catch (error) {
    if (error instanceof HarnessError) {
      console.error(error.message)
      if (error.cause) console.error(`  cause: ${String(error.cause.message).split('\n')[0]}`)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  }
}

await main()
