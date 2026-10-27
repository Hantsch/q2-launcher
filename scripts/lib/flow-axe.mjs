// Axe check for `ui:flow` scripts: one injection of axe-core per page, zero violations expected.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.mjs'
import { AXE_RUN_OPTIONS } from './session.mjs'

const axeSource = readFileSync(join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')

async function ensureAxe(page) {
  const present = await page.evaluate(() => typeof window.axe !== 'undefined')
  if (!present) await page.evaluate(axeSource)
}

/**
 * Throws unless axe reports zero violations. `context` is an optional CSS selector that scopes the
 * run to that subtree; without it the whole page is checked.
 */
export async function assertNoAxeViolations(page, label, context) {
  await ensureAxe(page)
  const results = await page.evaluate(
    async ({ context: scope, options }) =>
      scope ? await window.axe.run(scope, options) : await window.axe.run(options),
    { context, options: AXE_RUN_OPTIONS },
  )
  if (!Array.isArray(results?.violations)) {
    throw new Error(
      `axe.run() returned no violations array during '${label}' (got ${typeof results})`,
    )
  }
  if (results.violations.length !== 0) {
    const ids = results.violations
      .map((violation) => `${violation.id} (${violation.impact})`)
      .join(', ')
    throw new Error(
      `expected zero axe violations during '${label}', got ${results.violations.length}: ${ids}`,
    )
  }
}
