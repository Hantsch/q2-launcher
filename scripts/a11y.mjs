// D5 (docs/requirements/026-ui-verification-harness.md): injects axe-core into
// every screen in `scripts/lib/screens.mjs` over the same harness `shot.mjs`
// uses, and leaves behind `.ui-verify/a11y.json` (raw per-screen violations)
// plus `.ui-verify/a11y.md` (grouped by impact, human-readable). Run via
// `npm run ui:a11y`.
//
// Mirrors shot.mjs's structure on purpose (same registry, same "never abort
// the whole run" behaviour for an unreachable screen) so the two scripts stay
// easy to read side by side.
//
// Exit codes (story 026 Decisions): `2` if any violation anywhere has impact
// `serious`/`critical`; `1` if the app/harness itself failed for any screen
// (build missing, screen unreachable, main-process crash) — that takes
// priority in the sense that it is reported and also considered a failing
// run, but the two are orthogonal: a screen that never loaded never got a
// chance to produce a11y findings, so it is recorded as "unreachable, axe not
// run" rather than a fabricated empty violations list; `0` otherwise (clean,
// or only minor/moderate findings).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { FIXTURE_VARIANTS, writeFixture } from './lib/fixture.mjs'
import { HarnessError, withApp } from './lib/harness.mjs'
import { REPO_ROOT, UI_VERIFY_ROOT } from './lib/paths.mjs'
import { SCREENS } from './lib/screens.mjs'

const A11Y_JSON_PATH = join(UI_VERIFY_ROOT, 'a11y.json')
const A11Y_MD_PATH = join(UI_VERIFY_ROOT, 'a11y.md')
const AXE_SOURCE_PATH = join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js')

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor']

function fixtureDataPath(variant) {
  return join(UI_VERIFY_ROOT, 'fixture', variant, 'userdata', 'state.json')
}

/** Same convenience as shot.mjs: seed whatever variant is missing rather than failing. */
function ensureFixtures() {
  const needed = new Set(SCREENS.map((entry) => entry.variant))
  const missing = FIXTURE_VARIANTS.filter(
    (variant) => needed.has(variant) && !existsSync(fixtureDataPath(variant)),
  )
  if (missing.length === 0) return
  console.log(`fixture missing for ${missing.join(', ')} — seeding (npm run ui:seed logic)`)
  for (const variant of missing) writeFixture(variant)
}

/** Trims a violation down to what a report needs: counts and one example, not every node's full HTML. */
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

/**
 * Runs one registry entry at one viewport. Never throws: an unreachable
 * screen or a harness failure is turned into a record instead, mirroring
 * shot.mjs's `shootOne`.
 */
async function auditOne(entry, viewport) {
  const key = `${entry.id}@${viewport.width}x${viewport.height}`
  const axeSource = readFileSync(AXE_SOURCE_PATH, 'utf8')

  try {
    const outcome = await withApp({ variant: entry.variant, viewport }, async ({ page, log }) => {
      try {
        await entry.navigate(page)
      } catch (error) {
        return { reached: false, reason: error.message, log }
      }
      await page.evaluate(axeSource)
      const results = await page.evaluate(async () => await window.axe.run())
      return { reached: true, results, log }
    })

    const { log } = outcome
    if (!outcome.reached) {
      return {
        key,
        harnessOk: false,
        record: {
          status: 'unreachable',
          reason: outcome.reason,
          violations: [],
        },
      }
    }

    const hasAppFailure = log.errors.length > 0 || log.pageErrors.length > 0 || log.mainCrashed
    if (hasAppFailure) {
      return {
        key,
        harnessOk: false,
        record: {
          status: 'error',
          reason: 'renderer console error/exception or main-process crash during axe run',
          consoleErrors: log.errors.map((message) => message.text),
          pageErrors: log.pageErrors,
          violations: outcome.results.violations.map(summarizeViolation),
        },
      }
    }

    return {
      key,
      harnessOk: true,
      record: {
        status: 'audited',
        violations: outcome.results.violations.map(summarizeViolation),
      },
    }
  } catch (error) {
    // withApp itself failed (build missing, containment guard, main crash the
    // screen's own fn never got a chance to observe) — axe never ran.
    return {
      key,
      harnessOk: false,
      record: {
        status: 'error',
        reason: error instanceof HarnessError ? error.message : String(error.message ?? error),
        violations: [],
      },
    }
  }
}

function impactRank(impact) {
  const index = IMPACT_ORDER.indexOf(impact)
  return index === -1 ? IMPACT_ORDER.length : index
}

function buildMarkdown(entries) {
  const lines = ['# Accessibility report (axe-core)', '']

  const totalsByImpact = Object.fromEntries(IMPACT_ORDER.map((impact) => [impact, 0]))
  const unreachable = []
  for (const { key, record } of entries) {
    if (record.status !== 'audited') {
      unreachable.push({ key, status: record.status, reason: record.reason })
      continue
    }
    for (const violation of record.violations) {
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
    for (const { key, record } of entries) {
      if (record.status !== 'audited') continue
      for (const violation of record.violations) {
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

function printSummary(entries) {
  console.log('\nui:a11y summary')
  const totalsByImpact = Object.fromEntries(IMPACT_ORDER.map((impact) => [impact, 0]))
  const unreachableKeys = []

  for (const { key, harnessOk, record } of entries) {
    if (!harnessOk) {
      unreachableKeys.push(key)
      console.log(`  ${key} — ${record.status}${record.reason ? ` (${record.reason.split('\n')[0]})` : ''}`)
      continue
    }
    const byImpact = {}
    for (const violation of record.violations) {
      byImpact[violation.impact] = (byImpact[violation.impact] ?? 0) + 1
      if (totalsByImpact[violation.impact] !== undefined) totalsByImpact[violation.impact] += 1
    }
    const bits = IMPACT_ORDER.filter((impact) => byImpact[impact] > 0).map(
      (impact) => `${byImpact[impact]} ${impact}`,
    )
    console.log(`  ${key} — audited${bits.length > 0 ? ` (${bits.join(', ')})` : ' (clean)'}`)
  }

  console.log(
    `\nviolations: ${IMPACT_ORDER.map((impact) => `${totalsByImpact[impact]} ${impact}`).join(', ')}`,
  )
  if (unreachableKeys.length > 0) {
    console.log(`unreachable/errored: ${unreachableKeys.join(', ')}`)
  }

  return { totalsByImpact, unreachableKeys }
}

async function main() {
  ensureFixtures()
  mkdirSync(UI_VERIFY_ROOT, { recursive: true })

  const results = {}
  const entries = []

  for (const entry of SCREENS) {
    for (const viewport of entry.viewports) {
      const outcome = await auditOne(entry, viewport)
      results[outcome.key] = outcome.record
      entries.push(outcome)
    }
  }

  writeFileSync(A11Y_JSON_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  writeFileSync(A11Y_MD_PATH, buildMarkdown(entries), 'utf8')

  const { totalsByImpact, unreachableKeys } = printSummary(entries)

  if (unreachableKeys.length > 0) {
    process.exitCode = 1
    return
  }
  if (totalsByImpact.critical > 0 || totalsByImpact.serious > 0) {
    process.exitCode = 2
    return
  }
  process.exitCode = 0
}

await main()
