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
    throw new HarnessError(
      `unknown flow '${name}' — expected scripts/flows/${name}.mjs`,
    )
  }
  const mod = await import(pathToFileURL(path).href)
  if (typeof mod.default !== 'function') {
    throw new HarnessError(`scripts/flows/${name}.mjs must have a default export function`)
  }
  return mod.default
}

async function runFlow(name) {
  const flowFn = await loadFlow(name)

  let currentStep = null
  const step = (label) => {
    currentStep = label
    console.log(`  step: ${label}`)
  }

  mkdirSync(FLOWS_SCREENSHOTS_DIR, { recursive: true })

  await withApp({ variant: 'populated', viewport: VIEWPORT_DEFAULT }, async ({ page, app, log }) => {
    const shot = async (label) => {
      const filePath = join(FLOWS_SCREENSHOTS_DIR, `${name}-${label}.png`)
      await page.screenshot({ path: filePath })
      console.log(`  shot: ${filePath}`)
    }

    try {
      await flowFn({ page, app, shot, log, step })
    } catch (error) {
      const stepInfo = currentStep ? ` at step '${currentStep}'` : ''
      throw new HarnessError(`flow '${name}' failed${stepInfo}: ${error.message}`, {
        cause: error,
      })
    }
  })
}

async function main() {
  const name = process.argv[2]
  if (!name) {
    console.error('usage: node scripts/flow.mjs <name>')
    process.exitCode = 1
    return
  }

  try {
    await runFlow(name)
    console.log(`flow '${name}' OK`)
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
