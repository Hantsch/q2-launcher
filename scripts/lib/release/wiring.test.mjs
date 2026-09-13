import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, test } from 'vitest'
import { parseChangelog, readUnreleased } from './changelog.mjs'
import { planRelease } from './plan.mjs'

/**
 * Story 096: end-to-end wiring tests that read the repo's real files rather than fixtures, so a
 * later deliverable's docs edit or an accidental revert shows up as a failing test. This file
 * grows with each deliverable (D2 seeds it; D5/D6 add more) — keep each test self-contained.
 */

const CHANGELOG_PATH = fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url))
const README_PATH = fileURLToPath(new URL('../../../README.md', import.meta.url))
const ELECTRON_BUILDER_PATH = fileURLToPath(new URL('../../../electron-builder.yml', import.meta.url))
const RELEASE_WORKFLOW_PATH = fileURLToPath(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
)
const AI_SCRUM_PROFILE_PATH = fileURLToPath(new URL('../../../.claude/ai-scrum.md', import.meta.url))

describe('release pipeline wiring', () => {
  test("the repo's CHANGELOG.md is Keep-a-Changelog shaped and its Unreleased section carries the beta's entries", () => {
    const changelog = readFileSync(CHANGELOG_PATH, 'utf8')

    expect(changelog.startsWith('# Changelog')).toBe(true)
    expect(changelog).toContain('## Unreleased')

    // The `## Unreleased` heading existing is a permanent structural invariant, but the section
    // staying non-empty is NOT: `promote()` (changelog.mjs) moves its bullets into a new dated
    // version section and resets Unreleased back to just the placeholder, and this project's
    // normal workflow can legitimately leave Unreleased empty afterward until the next
    // user-facing story adds an entry. So the permanent, forever-true assertion is "the beta's
    // entries are present somewhere" — either still under Unreleased, or already promoted into
    // the most recent (topmost) version section (`parseChangelog(...).prior[0]`, the first prior
    // section after Unreleased) — never a requirement that Unreleased itself stays non-empty.
    const { bullets: unreleasedBullets } = readUnreleased(changelog)
    const { prior } = parseChangelog(changelog)
    const latestVersionBullets = (prior[0]?.categories ?? []).flatMap((c) => c.bullets)
    expect(unreleasedBullets.length + latestVersionBullets.length).toBeGreaterThan(0)

    const readme = readFileSync(README_PATH, 'utf8')
    expect(readme).not.toContain('No release build is published yet')
    // Positive check to match: not just that the old "no build yet" sentence is gone, but that
    // its replacement actually names GitHub Releases and the SmartScreen warning.
    expect(readme).toContain('SmartScreen')
    expect(readme).toContain('github.com/Hantsch/q2-launcher/releases')
  })

  test('electron-builder publishes to Hantsch/q2-launcher so latest.yml is written', () => {
    const raw = readFileSync(ELECTRON_BUILDER_PATH, 'utf8')
    const config = yaml.load(raw)

    expect(config.publish.provider).toBe('github')
    expect(config.publish.owner).toBe('Hantsch')
    expect(config.publish.repo).toBe('q2-launcher')
  })

  describe("D5: .github/workflows/release.yml", () => {
    /** @returns {any} the parsed workflow, re-read per test so no test can leak a mutation. */
    function readWorkflow() {
      return yaml.load(readFileSync(RELEASE_WORKFLOW_PATH, 'utf8'))
    }

    test('grants contents: write and runs on windows-latest', () => {
      const workflow = readWorkflow()

      expect(workflow.permissions.contents).toBe('write')

      const jobs = Object.values(workflow.jobs)
      expect(jobs.length).toBeGreaterThan(0)
      for (const job of jobs) {
        expect(job['runs-on']).toBe('windows-latest')
      }
    })

    test('workflow_dispatch exposes exactly version, bump and dry_run as inputs', () => {
      const workflow = readWorkflow()
      // js-yaml parses the `on:` key as the boolean `true` (YAML 1.1 quirk), never as the string
      // "on" - read it back the same way.
      const on = workflow.on ?? workflow[true]
      const inputs = on.workflow_dispatch.inputs

      expect(Object.keys(inputs).sort()).toEqual(['bump', 'dry_run', 'version'].sort())
    })

    test('the job carries a guard that skips a push carrying [skip ci]', () => {
      const workflow = readWorkflow()
      const jobs = Object.values(workflow.jobs)

      const guarded = jobs.some((job) => {
        const condition = String(job.if ?? '')
        return condition.includes('[skip ci]') && condition.includes('contains(')
      })
      expect(guarded).toBe(true)
    })

    test('the release step disables electron-builder code-signing discovery', () => {
      const workflow = readWorkflow()
      const jobs = Object.values(workflow.jobs)

      const envs = jobs.flatMap((job) => [job.env, ...(job.steps ?? []).map((step) => step.env)])
      const hasFlag = envs.some(
        (env) => env && env.CSC_IDENTITY_AUTO_DISCOVERY === 'false',
      )
      expect(hasFlag).toBe(true)
    })

    test('the release commit carries [skip ci] and the workflow skips such a commit', () => {
      // (a) the commit message scripts/release.mjs actually produces carries the marker - derived
      // from planRelease itself (plan.mjs), not re-typed here, so a template change would fail this.
      const changelog = `# Changelog

## Unreleased

### Added
- something releasable

## 1.0.0 — 2026-01-01

### Added
- the first release
`
      const pkgText = JSON.stringify({ name: 'q2-launcher', version: '1.0.0' }, null, 2) + '\n'
      const lockText =
        JSON.stringify(
          {
            name: 'q2-launcher',
            version: '1.0.0',
            lockfileVersion: 3,
            packages: { '': { name: 'q2-launcher', version: '1.0.0' } },
          },
          null,
          2,
        ) + '\n'

      const plan = planRelease({
        changelogText: changelog,
        pkgText,
        lockText,
        tags: [],
        requestedVersion: undefined,
        bump: 'patch',
        dryRun: false,
        isCi: true,
        today: '2026-03-01',
      })

      const commitCommand = plan.commands.find((command) => command.kind === 'git-commit')
      expect(commitCommand).toBeDefined()
      expect(commitCommand.argv).toContain('release: 1.0.1 [skip ci]')

      // (b) the workflow's own guard references that same marker.
      const workflow = readWorkflow()
      const jobs = Object.values(workflow.jobs)
      const guarded = jobs.some((job) => String(job.if ?? '').includes('[skip ci]'))
      expect(guarded).toBe(true)
    })
  })

  test('changelog-path points at CHANGELOG.md', () => {
    const profile = readFileSync(AI_SCRUM_PROFILE_PATH, 'utf8')

    expect(profile).toMatch(/^changelog-path:\s*CHANGELOG\.md\s*$/m)
    expect(profile).not.toMatch(/^changelog-path:\s*none\s*$/m)
  })
})
