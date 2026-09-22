import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, test } from 'vitest'
import { expectedAssets } from './artifacts.mjs'
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

  test("the built artifact names match artifacts.mjs's expectations and carry no space", () => {
    const config = yaml.load(readFileSync(ELECTRON_BUILDER_PATH, 'utf8'))

    // The drift guard `artifacts.mjs` claims to have: it hardcodes the `Q2-Launcher` prefix, so
    // renaming the pattern here without renaming it there must fail a test rather than only
    // surface as a release that refuses after a full build.
    const resolved = config.win.artifactName
      .replace('${version}', '1.0.0-beta.1')
      .replace('${arch}', 'x64')
      .replace('${ext}', 'exe')
    expect(resolved).toBe(expectedAssets('1.0.0-beta.1')[0])
    // A space here is what silently breaks electron-updater - latest.yml's `url` gets the
    // sanitised name, the uploaded asset keeps the raw one. See that field's own comment.
    expect(config.win.artifactName).not.toContain(' ')
    expect(config.win.artifactName).not.toContain('${productName}')
  })

  test("electron-builder's linux.artifactName is the hyphenated, space-free name the asset check expects", () => {
    const config = yaml.load(readFileSync(ELECTRON_BUILDER_PATH, 'utf8'))

    // artifacts.mjs hardcodes 'Q2-Launcher' as PRODUCT_NAME (not exported - it stays
    // fs/path-free on purpose) and its own comment says a future rename must be caught by drift
    // rather than silently. Derive that same prefix from the Windows asset artifacts.mjs *does*
    // expose (expectedAssets), rather than re-typing the literal 'Q2-Launcher-' here, so a rename
    // of the shared prefix in either place fails this test.
    const winAsset = expectedAssets('1.0.0-beta.1')[0]
    const prefix = winAsset.slice(0, winAsset.indexOf('1.0.0-beta.1'))
    expect(prefix).toBe('Q2-Launcher-')

    expect(config.linux.artifactName).toContain(prefix)
    expect(config.linux.artifactName.startsWith('${productName}')).toBe(false)
    // A space here breaks electron-updater exactly as it would on Windows - see that field's
    // comment and win.artifactName's above it.
    expect(config.linux.artifactName).not.toContain(' ')
    expect(config.linux.artifactName).not.toContain('${productName}')

    // electron-builder resolves `${arch}` to `x86_64` (not `x64`) for AppImage builds - assert
    // the actual resolved filename, not just the raw template string, so a regression to `x64`
    // here (which would silently produce a wrong/missing asset name on a real Linux build) fails.
    const resolved = config.linux.artifactName
      .replace('${version}', '1.0.0-beta.1')
      .replace('${arch}', 'x86_64')
      .replace('${ext}', 'AppImage')
    expect(resolved).toBe('Q2-Launcher-1.0.0-beta.1-linux-x86_64.AppImage')
  })

  describe("D5: .github/workflows/release.yml", () => {
    /** @returns {any} the parsed workflow, re-read per test so no test can leak a mutation. */
    function readWorkflow() {
      return yaml.load(readFileSync(RELEASE_WORKFLOW_PATH, 'utf8'))
    }

    test('grants contents: write and publishes from windows-latest', () => {
      const workflow = readWorkflow()

      expect(workflow.permissions.contents).toBe('write')

      // Story 101 D3 split the single job into three, so "every job is windows-latest" is no
      // longer the invariant - "the job that tags and publishes is" still is, and it is the one
      // that matters: the Windows artifacts and the `latest.yml` every installed Windows client
      // resolves its update through must keep being produced by a real Windows runner, never by
      // Wine on Linux.
      expect(workflow.jobs.release['runs-on']).toBe('windows-latest')
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

    describe('D3 (story 101): three jobs, one release', () => {
      test('plan, build-linux and release exist, and release waits for both others', () => {
        const workflow = readWorkflow()

        expect(Object.keys(workflow.jobs).sort()).toEqual(['build-linux', 'plan', 'release'])

        // `needs` is what makes the split safe rather than merely parallel: the Windows job must
        // not start tagging and publishing before the Linux artifacts it has to upload exist, and
        // it must not derive its own version - it consumes the one `plan` decided.
        const needs = workflow.jobs.release.needs
        const needsList = Array.isArray(needs) ? needs : [needs]
        expect(needsList.sort()).toEqual(['build-linux', 'plan'])
        expect(workflow.jobs['build-linux'].needs).toBe('plan')
      })

      test('plan resolves the version once and every other job consumes that one value', () => {
        const workflow = readWorkflow()
        const plan = workflow.jobs.plan

        // The plan job runs the read-only mode - no build, no tag - and exposes what it decided.
        const planRun = (plan.steps ?? []).map((step) => step.run ?? '').join('\n')
        expect(planRun).toContain('--print-plan')
        expect(plan.outputs.version).toContain('steps.')

        // Both downstream jobs read `needs.plan.outputs.version` rather than deriving a version
        // of their own. A version derived twice is a release whose git tag and whose asset
        // filenames disagree - the assets would be uploaded under a name no client resolves.
        const downstream = JSON.stringify([workflow.jobs['build-linux'], workflow.jobs.release])
        expect(downstream).toContain('needs.plan.outputs.version')
        const releaseRun = (workflow.jobs.release.steps ?? []).map((s) => s.run ?? '').join('\n')
        expect(releaseRun).toContain('--version')
      })

      test('build-linux packages the AppImage and uploads it for the release job to stage', () => {
        const workflow = readWorkflow()
        const steps = workflow.jobs['build-linux'].steps ?? []

        expect(workflow.jobs['build-linux']['runs-on']).toBe('ubuntu-latest')
        expect(workflow.jobs.plan['runs-on']).toBe('ubuntu-latest')

        const runs = steps.map((step) => step.run ?? '').join('\n')
        expect(runs).toContain('npm run package:linux')

        const upload = steps.find((step) => String(step.uses ?? '').includes('upload-artifact'))
        expect(upload).toBeDefined()
        expect(upload.with.path).toContain('.AppImage')
        expect(upload.with.path).toContain('latest-linux.yml')
        // Never a bare `release/<version>/*`: a `latest.yml` travelling in this artifact would be
        // staged over the freshly built Windows one, which is the single URL every installed
        // Windows client resolves its update through.
        expect(upload.with.path).not.toContain('latest.yml\n')
        expect(String(upload.with.path).split('\n').filter(Boolean)).toHaveLength(2)

        // The release job downloads that same artifact and points the runner's staging variable
        // at where it landed, which is what gets the Linux files gated by the asset check.
        const releaseSteps = workflow.jobs.release.steps ?? []
        const download = releaseSteps.find((step) =>
          String(step.uses ?? '').includes('download-artifact'),
        )
        expect(download).toBeDefined()
        expect(download.with.name).toBe(upload.with.name)
        const releaseEnvs = releaseSteps.map((step) => step.env).filter(Boolean)
        const staging = releaseEnvs.find((env) => env.RELEASE_EXTRA_ASSETS_DIR)
        expect(staging).toBeDefined()
        expect(staging.RELEASE_EXTRA_ASSETS_DIR).toContain(download.with.path)
      })

      test('F2: build-linux promotes CHANGELOG.md before packaging, so the AppImage bundles real notes', () => {
        const workflow = readWorkflow()
        const steps = workflow.jobs['build-linux'].steps ?? []
        const runs = steps.map((step) => step.run ?? '')

        const promoteIndex = runs.findIndex((run) => run.includes('--promote-changelog'))
        const packageIndex = runs.findIndex((run) => run.includes('npm run package:linux'))

        // Without this, the packaged AppImage bundles a CHANGELOG.md still saying "## Unreleased"
        // (this checkout never sees the promotion the `release` job commits later), so
        // resolveReleaseNotes() (src/main/lib/release-notes.ts) finds no "## <version>" section
        // matching app.getVersion() and About is permanently empty on every Linux release.
        expect(promoteIndex).toBeGreaterThan(-1)
        expect(packageIndex).toBeGreaterThan(-1)
        expect(promoteIndex).toBeLessThan(packageIndex)

        // It reuses release.mjs's own version, not a second derivation - and passes the SAME
        // planned version build-linux already builds electron-builder's output directory/artifact
        // names against.
        const promoteStep = steps[promoteIndex]
        expect(runs[promoteIndex]).toContain('node scripts/release.mjs')
        expect(runs[promoteIndex]).toContain('--version')
        expect(JSON.stringify(promoteStep.env ?? {})).toContain('needs.plan.outputs.version')
      })
    })
  })

  test('changelog-path points at CHANGELOG.md', () => {
    const profile = readFileSync(AI_SCRUM_PROFILE_PATH, 'utf8')

    expect(profile).toMatch(/^changelog-path:\s*CHANGELOG\.md\s*$/m)
    expect(profile).not.toMatch(/^changelog-path:\s*none\s*$/m)
  })
})
