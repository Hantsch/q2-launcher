import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../../lib/logger'
import { parseManifestFile } from '../manifest-parse'
import { buildAssemblePlan, GLOB_DIRS } from './assemble'

/**
 * Story 076 D5: `docs/fixtures/archive-layouts.json` is a small, checked-in listing of what was
 * actually measured on the three real pinned archives (see the Requirement's table in
 * `docs/requirements/076-bootstrap-assembles-the-real-archives.md`). This suite is what keeps
 * that listing honest against three other things that could each drift independently:
 *
 *  - the shipped manifests (a re-pin changes a package's sha256 out from under the listing),
 *  - `assemble.ts`'s allowlist (a required entry whose every candidate is unmeasured/invented -
 *    the check only needs *one* recorded candidate per entry to pass, so a second, unmeasured
 *    candidate added alongside an already-recorded one is not what this catches), and
 *  - `scripts/lib/fixture.mjs`'s `BOOTSTRAP_FIXTURE_LAYOUT` (the offline fixture drifts from what
 *    the listing says the real archives look like).
 *
 * Mirrors `shipped-manifest.test.ts` for the repo-root file reading - this file lives one
 * directory deeper (`bootstrap/`), so its `REPO_ROOT` join needs one more `'..'`.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const ENGINES_MANIFEST_PATH = join(REPO_ROOT, 'content', 'q2_community_content', 'engines', 'manifest.json')
const GAMEDATA_MANIFEST_PATH = join(REPO_ROOT, 'content', 'q2_community_content', 'gamedata', 'manifest.json')
const ARCHIVE_LAYOUTS_PATH = join(REPO_ROOT, 'docs', 'fixtures', 'archive-layouts.json')

interface ArchiveLayoutPackage {
  role: 'engine' | 'demo' | 'point-release'
  id: string
  sha256: string
  paths: string[]
}

interface ArchiveLayouts {
  measuredOn: string
  packages: ArchiveLayoutPackage[]
}

function fakeLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function readArchiveLayouts(): ArchiveLayouts {
  return readJson(ARCHIVE_LAYOUTS_PATH) as ArchiveLayouts
}

/**
 * True if `fixturePath` is "a recorded real path" for `recordedPaths`: either it appears
 * verbatim, or it is nested under a recorded path that is itself a directory fact (the recorded
 * path is a proper prefix of the fixture path, followed by a `/`).
 */
function isRecordedRealPath(fixturePath: string, recordedPaths: string[]): boolean {
  return recordedPaths.some(
    (recorded) => recorded === fixturePath || fixturePath.startsWith(`${recorded}/`),
  )
}

describe('archive-layouts.json matches the shipped manifests, the allowlist and the bootstrap fixture', () => {
  it("the recorded listings match the shipped manifests' pinned ids and digests", () => {
    const log = fakeLogger()
    const layouts = readArchiveLayouts()

    const engines = parseManifestFile(readJson(ENGINES_MANIFEST_PATH), log)
    const gamedata = parseManifestFile(readJson(GAMEDATA_MANIFEST_PATH), log)
    if (!engines.ok || !gamedata.ok) throw new Error('expected ok results')

    const shippedById = new Map(
      [...engines.packages, ...gamedata.packages].map((pkg) => [pkg.id, pkg]),
    )

    expect(layouts.packages.length).toBeGreaterThan(0)
    for (const recorded of layouts.packages) {
      const shipped = shippedById.get(recorded.id)
      expect(shipped, `shipped manifest has no package with id "${recorded.id}"`).toBeDefined()
      expect(shipped?.sha256).toBe(recorded.sha256)
    }
  })

  it('every allowlist candidate resolves in a recorded listing', () => {
    const layouts = readArchiveLayouts()
    const layoutsByRole = new Map(layouts.packages.map((pkg) => [pkg.role, pkg]))

    const plan = buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers: false })
    // Only `required` entries are checked here: `baseq2/q2pro.menu` is `required: false` and is
    // deliberately excluded from the recorded listing (it was never independently measured - see
    // the story's Decisions). Filtering to `required === true` already excludes it; this comment
    // just makes that exclusion legible as deliberate, not an oversight.
    const requiredEntries = plan.filter((entry) => entry.required)
    expect(requiredEntries.length).toBeGreaterThan(0)

    for (const entry of requiredEntries) {
      const recorded = layoutsByRole.get(entry.role)
      expect(recorded, `no recorded listing for role "${entry.role}"`).toBeDefined()
      const resolves = entry.from.some((candidate) => recorded?.paths.includes(candidate))
      expect(
        resolves,
        `none of [${entry.from.join(', ')}] (role "${entry.role}") appear in the recorded listing's paths [${recorded?.paths.join(', ')}]`,
      ).toBe(true)
    }

    // Story 080 D2 made `buildAssemblePlan` engine-aware, but `layoutsByRole` above is still keyed
    // by `role` and resolves to whichever "engine"-role package appears last in the JSON array -
    // it cannot single out R1Q2 from Q2PRO. This checks the same underlying fact - that R1Q2's
    // three required client files are present, verbatim, in the recorded listing - by looking
    // that entry up by `id` instead.
    const layoutsById = new Map(layouts.packages.map((pkg) => [pkg.id, pkg]))
    const r1q2Layout = layoutsById.get('r1q2-b8012-msvs2022-win32')
    expect(r1q2Layout, 'no recorded listing for id "r1q2-b8012-msvs2022-win32"').toBeDefined()
    for (const requiredPath of ['r1q2.exe', 'ref_r1gl.dll', 'baseq2/gamex86.dll']) {
      expect(
        r1q2Layout?.paths,
        `"${requiredPath}" missing from the r1q2-b8012-msvs2022-win32 recorded listing`,
      ).toContain(requiredPath)
    }
  })

  it('every GLOB_DIRS candidate resolves in a recorded listing, except the documented video/ absence', () => {
    // Story 076 review finding F1: `buildAssemblePlan()`'s fixed entries were cross-checked above,
    // but `GLOB_DIRS` (`baseq2/players`, `baseq2/video`) sits outside that plan and was never
    // checked against the listing at all - so a candidate that no real archive actually has could
    // silently sit in the allowlist forever. `GLOB_DIRS` entries are not per-role (the job searches
    // every source dir for them, "first found wins"), so a candidate only needs to resolve
    // *somewhere* in the listing, not for every role.
    const layouts = readArchiveLayouts()
    const allRecordedPaths = layouts.packages.flatMap((pkg) => pkg.paths)

    // AC4: `video/` is absent from every real pinned archive (the Requirement's table) - a
    // measured, documented absence, not an oversight this test should flag.
    const DOCUMENTED_ABSENT_EVERYWHERE = new Set(['baseq2/video'])

    for (const globDir of GLOB_DIRS) {
      const resolvesSomewhere = globDir.from.some((candidate) =>
        allRecordedPaths.some(
          (recorded) =>
            recorded === candidate ||
            candidate.startsWith(`${recorded}/`) ||
            recorded.startsWith(`${candidate}/`),
        ),
      )
      if (DOCUMENTED_ABSENT_EVERYWHERE.has(globDir.to)) {
        expect(
          resolvesSomewhere,
          `"${globDir.to}" is recorded as a documented real-archive absence, but now appears in the listing - update DOCUMENTED_ABSENT_EVERYWHERE or this test's premise is stale`,
        ).toBe(false)
      } else {
        expect(
          resolvesSomewhere,
          `none of [${globDir.from.join(', ')}] (glob dir "${globDir.to}") appear in any recorded listing`,
        ).toBe(true)
      }
    }
  })

  it('every recorded real path is mirrored in the bootstrap fixture', async () => {
    // The reverse direction of "every bootstrap fixture path is a recorded real path" below
    // (story 076 review finding F3): that test only proves the fixture never *invents* a path: a
    // fixture that silently stopped writing a measured real path (e.g. dropped `baseq2/pak1.pak`)
    // would still pass it. AC6 claims the fixture *mirrors* the real archives, which is a claim
    // about both directions.
    const layouts = readArchiveLayouts()
    const layoutsByRole = new Map(layouts.packages.map((pkg) => [pkg.role, pkg]))

    // @ts-expect-error -- scripts/lib/fixture.mjs is outside tsconfig.node.json's `include`
    const fixtureModule = await import('../../../../../scripts/lib/fixture.mjs')
    const fixtureLayout = fixtureModule.BOOTSTRAP_FIXTURE_LAYOUT as Record<string, string[]>

    for (const role of ['engine', 'demo', 'point-release'] as const) {
      const recorded = layoutsByRole.get(role)
      expect(recorded, `no recorded listing for role "${role}"`).toBeDefined()
      const fixturePaths = fixtureLayout[role] ?? []

      for (const recordedPath of recorded?.paths ?? []) {
        const mirrored = fixturePaths.some(
          (fixturePath) =>
            fixturePath === recordedPath || fixturePath.startsWith(`${recordedPath}/`),
        )
        expect(
          mirrored,
          `recorded real path "${recordedPath}" (role "${role}") has no matching fixture path in [${fixturePaths.join(', ')}] - the fixture no longer mirrors this measured fact`,
        ).toBe(true)
      }
    }
  })

  it('every bootstrap fixture path is a recorded real path', async () => {
    const layouts = readArchiveLayouts()
    const layoutsByRole = new Map(layouts.packages.map((pkg) => [pkg.role, pkg]))

    // `scripts/` is plain Node ESM outside both TS projects (see `fixture.mjs`'s own doc
    // comment), so `tsconfig.node.json` has no declaration for this module - a dynamic import of
    // it is real and resolves fine at runtime (proven by this test passing), it just has no static
    // type.
    // @ts-expect-error -- scripts/lib/fixture.mjs is outside tsconfig.node.json's `include`
    const fixtureModule = await import('../../../../../scripts/lib/fixture.mjs')
    const fixtureLayout = fixtureModule.BOOTSTRAP_FIXTURE_LAYOUT as Record<string, string[]>

    // `baseq2/q2pro.menu` ships in the fixture (it ships in the real engine package, per
    // buildFixedEntries()'s own comment) but is deliberately absent from archive-layouts.json's
    // recorded paths - the listing only claims what the Requirement's table actually measured,
    // and q2pro.menu was added to the allowlist by a Sprint Decision, not by measurement (see
    // this suite's "every allowlist candidate resolves in a recorded listing" test above, which
    // filters to `required` entries for exactly this reason). A fixture path that matches a
    // `required: false` allowlist entry's `to`
    // for its role is real (it is on the allowlist, sourced from the same package) even though it
    // is not "measured", so it counts as accounted-for here too - resolved from `assemble.ts`'s
    // own `required` flag rather than a second, hand-typed literal.
    const optionalTargetsByRole = new Map<string, Set<string>>()
    for (const entry of buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers: false })) {
      if (entry.required) continue
      const set = optionalTargetsByRole.get(entry.role) ?? new Set<string>()
      set.add(entry.to)
      optionalTargetsByRole.set(entry.role, set)
    }

    for (const role of ['engine', 'demo', 'point-release'] as const) {
      const recorded = layoutsByRole.get(role)
      expect(recorded, `no recorded listing for role "${role}"`).toBeDefined()
      const fixturePaths = fixtureLayout[role] ?? []
      expect(fixturePaths.length).toBeGreaterThan(0)
      const optionalTargets = optionalTargetsByRole.get(role) ?? new Set<string>()

      for (const fixturePath of fixturePaths) {
        const accountedFor =
          isRecordedRealPath(fixturePath, recorded?.paths ?? []) || optionalTargets.has(fixturePath)
        expect(
          accountedFor,
          `fixture path "${fixturePath}" (role "${role}") is not a recorded real path in [${recorded?.paths.join(', ')}] and does not match a known-optional allowlist entry`,
        ).toBe(true)
      }
    }
  })
})
