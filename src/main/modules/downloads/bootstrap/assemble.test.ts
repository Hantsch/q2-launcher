import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import { ENGINE_DEFINITIONS } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleInstallation, buildAssemblePlan, type AssembleSource } from './assemble'

/**
 * Story 089 review F3: whether this sandbox can create file symlinks at all. Windows refuses
 * `symlink()` with `EPERM` unless the process is elevated or Developer Mode is on (confirmed in
 * this very dev environment), so the F3 regression test below is gated on this rather than
 * failing everywhere the fix itself was written - mirrors `extractor.test.ts`'s `realBinary.exists`
 * gate for a capability the sandbox may not have.
 */
const canSymlink = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'q2-launcher-symlink-probe-'))
  try {
    const real = join(dir, 'real.txt')
    writeFileSync(real, 'probe')
    symlinkSync(real, join(dir, 'link.txt'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})()

/**
 * Story 074 D3. AC8 is a hard negative requirement: the 3.20 point-release package's extraction
 * also contains a `ctf/` payload that must never land in the assembled `baseq2` installation,
 * alongside `xatrix/`/`rogue/` from other real-world Q2 archives. The mechanism is an allowlist,
 * not a filter, so this suite's job is to prove the *absence* of everything not on the list, not
 * merely the presence of what is - a filter-shaped bug (e.g. an accidental recursive copy) would
 * still pass a presence-only assertion.
 *
 * Story 076 D1 extends this suite: the allowlist's `from` is now an ordered candidate list (not a
 * single path), entries carry `role`/`required`, and the layouts below mirror the *real* pinned
 * archives rather than the earlier guess (demo pak0 under `Install/Data/baseq2/`, engine binary
 * named `q2pro64.exe` at the zip root, `baseq2/pak1.pak` and `baseq2/q2pro.menu` added, players
 * sourced from `baseq2/players`).
 */

const Q2PRO_ENGINE_TARGET =
  ENGINE_DEFINITIONS.find((engine) => engine.kind === 'q2pro')?.executables[0] ?? 'q2pro.exe'

let sourceRoot: string
let targetRoot: string

beforeEach(async () => {
  sourceRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-assemble-src-'))
  targetRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-assemble-dst-'))
})

afterEach(async () => {
  await rm(sourceRoot, { recursive: true, force: true })
  await rm(targetRoot, { recursive: true, force: true })
})

async function writeFixtureFile(relativePath: string, content = 'data'): Promise<void> {
  const path = join(sourceRoot, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

/** Builds the fixture extraction tree: allowlisted files, plus the never-copy payloads. */
async function seedExtractionTree(): Promise<void> {
  await writeFixtureFile(join('baseq2', 'pak0.pak'))
  await writeFixtureFile(join('baseq2', 'pak1.pak'))
  await writeFixtureFile(join('baseq2', 'pak2.pak'))
  await writeFixtureFile('q2pro.exe')
  await writeFixtureFile(join('baseq2', 'gamex86_64.dll'))
  await writeFixtureFile(join('baseq2', 'q2pro.menu'))

  // Never on the allowlist - AC8's negative proof.
  await writeFixtureFile(join('ctf', 'pak0.pak'))
  await writeFixtureFile(join('ctf', 'ctf1.bsp'))
  await writeFixtureFile(join('xatrix', 'pak0.pak'))
  await writeFixtureFile(join('rogue', 'pak0.pak'))
}

async function seedVideoAndPlayers(): Promise<void> {
  await writeFixtureFile(join('baseq2', 'video', 'idlog.cin'))
  await writeFixtureFile(join('baseq2', 'video', 'end.cin'))
  await writeFixtureFile(join('baseq2', 'players', 'male', 'skin.pcx'), 'skin')
}

async function namesUnder(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
}

/**
 * Story 080 D2: `findSource` now restricts its search to sources whose `role` matches the plan
 * entry's own role. Most of this suite's fixtures put every role's files in the same physical
 * directory (they predate the per-role split), so this hands back one `AssembleSource` per role,
 * all pointing at the same `dir` - preserving "everything in this one tree is findable" while
 * still exercising the new role filter honestly (a q2pro-only test never needs the 'r1q2' role).
 */
function allRoleSources(dir: string, packageId = 'core'): AssembleSource[] {
  return [
    { packageId, dir, role: 'engine' },
    { packageId, dir, role: 'demo' },
    { packageId, dir, role: 'point-release' },
  ]
}

describe('buildAssemblePlan (pure)', () => {
  it('the fixed allowlist entries do not depend on the toggle', () => {
    const off = buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers: false })
    const on = buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers: true })

    expect(off).toEqual(on)
    expect(off.map((e) => e.to).sort()).toEqual(
      [
        'baseq2/gamex86_64.dll',
        'baseq2/pak0.pak',
        'baseq2/pak1.pak',
        'baseq2/pak2.pak',
        'baseq2/q2pro.menu',
        Q2PRO_ENGINE_TARGET,
      ].sort(),
    )
  })

  it('never plans a ctf/xatrix/rogue candidate, whatever the toggle', () => {
    for (const includeVideoAndPlayers of [false, true]) {
      const plan = buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers })
      for (const entry of plan) {
        for (const candidate of entry.from) {
          expect(candidate.startsWith('ctf')).toBe(false)
          expect(candidate.startsWith('xatrix')).toBe(false)
          expect(candidate.startsWith('rogue')).toBe(false)
        }
      }
    }
  })

  it('tags every entry with its role and required-ness per the story mapping', () => {
    const plan = buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers: false })
    const byTo = new Map(plan.map((entry) => [entry.to, entry]))

    expect(byTo.get('baseq2/pak0.pak')).toMatchObject({ role: 'demo', required: true })
    expect(byTo.get('baseq2/pak1.pak')).toMatchObject({ role: 'point-release', required: true })
    expect(byTo.get('baseq2/pak2.pak')).toMatchObject({ role: 'point-release', required: true })
    expect(byTo.get(Q2PRO_ENGINE_TARGET)).toMatchObject({ role: 'engine', required: true })
    expect(byTo.get('baseq2/gamex86_64.dll')).toMatchObject({ role: 'engine', required: true })
    expect(byTo.get('baseq2/q2pro.menu')).toMatchObject({ role: 'engine', required: false })
  })
})

describe('assembleInstallation', () => {
  it('toggle off: copies exactly the allowlisted files, ctf/xatrix/rogue/video/players absent', async () => {
    await seedExtractionTree()
    await seedVideoAndPlayers()

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: false,
    })

    expect(result.copiedFiles.sort()).toEqual(
      [
        'baseq2/gamex86_64.dll',
        'baseq2/pak0.pak',
        'baseq2/pak1.pak',
        'baseq2/pak2.pak',
        'baseq2/q2pro.menu',
        Q2PRO_ENGINE_TARGET,
      ].sort(),
    )

    // Positive: the allowlisted files landed, including the engine's own game module DLL.
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual(
      ['gamex86_64.dll', 'pak0.pak', 'pak1.pak', 'pak2.pak', 'q2pro.menu'].sort(),
    )
    expect(await namesUnder(targetRoot)).toEqual(['baseq2', Q2PRO_ENGINE_TARGET].sort())

    // Negative (AC8's actual proof): nothing else exists under the target root at all.
    expect(await namesUnder(join(targetRoot, 'ctf'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'xatrix'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'rogue'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'baseq2', 'video'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'baseq2', 'players'))).toEqual([])
    const topLevel = await namesUnder(targetRoot)
    expect(topLevel).not.toContain('ctf')
    expect(topLevel).not.toContain('xatrix')
    expect(topLevel).not.toContain('rogue')
    expect(topLevel).not.toContain('video')
    expect(topLevel).not.toContain('players')
  })

  it('toggle on: brings video/players in, still with no ctf/xatrix/rogue', async () => {
    await seedExtractionTree()
    await seedVideoAndPlayers()

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: true,
    })

    expect(result.copiedFiles.sort()).toEqual(
      [
        'baseq2/gamex86_64.dll',
        'baseq2/pak0.pak',
        'baseq2/pak1.pak',
        'baseq2/pak2.pak',
        'baseq2/q2pro.menu',
        Q2PRO_ENGINE_TARGET,
        join('baseq2', 'video', 'idlog.cin'),
        join('baseq2', 'video', 'end.cin'),
        join('baseq2', 'players', 'male'),
      ].sort(),
    )

    // Positive: the engine's own game module DLL landed alongside the paks, video/players did too.
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toContain('gamex86_64.dll')
    expect(await namesUnder(join(targetRoot, 'baseq2', 'video'))).toEqual(['end.cin', 'idlog.cin'])
    expect(await namesUnder(join(targetRoot, 'baseq2', 'players'))).toEqual(['male'])
    expect(await namesUnder(join(targetRoot, 'baseq2', 'players', 'male'))).toEqual(['skin.pcx'])

    // Negative: the never-allowlisted payloads are still absent even with the toggle on.
    const topLevel = await namesUnder(targetRoot)
    expect(topLevel).not.toContain('ctf')
    expect(topLevel).not.toContain('xatrix')
    expect(topLevel).not.toContain('rogue')
    expect(await namesUnder(join(targetRoot, 'ctf'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'xatrix'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'rogue'))).toEqual([])
  })

  it.skipIf(!canSymlink)(
    'review F3: a symlinked source file is copied as a real, independent file - never left as a symlink',
    async () => {
      await seedExtractionTree()
      // `pak0.pak` itself is a symlink into a second tree outside `sourceRoot`, standing in for the
      // "picked folder holds a symlink" case AC3's "copied (never linked)" wording rules out -
      // reachable now that story 089 lets the whole source folder be renderer/user-picked.
      const realDir = await mkdtemp(join(tmpdir(), 'q2-launcher-assemble-real-'))
      const realPak = join(realDir, 'pak0.pak')
      await writeFile(realPak, 'the real pak0 bytes')
      await rm(join(sourceRoot, 'baseq2', 'pak0.pak'), { force: true })
      await symlink(realPak, join(sourceRoot, 'baseq2', 'pak0.pak'), 'file')

      try {
        await assembleInstallation({
          sources: allRoleSources(sourceRoot),
          targetRoot,
          engine: 'q2pro',
          includeVideoAndPlayers: false,
        })

        const targetPak = join(targetRoot, 'baseq2', 'pak0.pak')
        expect((await lstat(targetPak)).isSymbolicLink()).toBe(false)
        expect(await readFile(targetPak, 'utf8')).toBe('the real pak0 bytes')

        // Independent of the source afterwards: replacing the real file's content must not be
        // visible through the copy - a symlink left in place would still show it.
        await writeFile(realPak, 'the real pak0 bytes, replaced')
        expect(await readFile(targetPak, 'utf8')).toBe('the real pak0 bytes')
      } finally {
        await rm(realDir, { recursive: true, force: true })
      }
    },
  )

  it('resolves each entry against multiple source dirs, first match wins', async () => {
    const otherSourceRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-assemble-src2-'))
    try {
      await mkdir(join(otherSourceRoot, 'baseq2'), { recursive: true })
      await writeFile(join(otherSourceRoot, 'baseq2', 'pak0.pak'), 'from-other')
      await writeFixtureFile(join('baseq2', 'pak1.pak'))
      await writeFixtureFile(join('baseq2', 'pak2.pak'))
      await writeFixtureFile('q2pro.exe')

      const result = await assembleInstallation({
        sources: [
          { packageId: 'core', dir: sourceRoot, role: 'point-release' },
          { packageId: 'core', dir: sourceRoot, role: 'engine' },
          { packageId: 'other', dir: otherSourceRoot, role: 'demo' },
        ],
        targetRoot,
        engine: 'q2pro',
        includeVideoAndPlayers: false,
      })

      expect(result.copiedFiles.sort()).toEqual(
        ['baseq2/pak0.pak', 'baseq2/pak1.pak', 'baseq2/pak2.pak', Q2PRO_ENGINE_TARGET].sort(),
      )
      expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual(
        ['pak0.pak', 'pak1.pak', 'pak2.pak'].sort(),
      )
    } finally {
      await rm(otherSourceRoot, { recursive: true, force: true })
    }
  })

  it('does not throw when an allowlisted file is missing, and reports only what was copied', async () => {
    // Only q2pro.exe present - the paks are missing entirely.
    await writeFixtureFile('q2pro.exe')

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: false,
    })

    expect(result.copiedFiles).toEqual([Q2PRO_ENGINE_TARGET])
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual([])
  })

  it('the allowlist covers the real source layouts and copies nothing else', async () => {
    // Laid out exactly like the real archives: demo pak0 nested under Install/Data/, engine
    // binary named q2pro64.exe (not q2pro.exe) at the zip root, plus everything else the real
    // packages ship alongside them. ctf/xatrix/rogue payload dirs are present to prove they're
    // never copied, mirroring AC8.
    await writeFixtureFile(join('Install', 'Data', 'baseq2', 'pak0.pak'))
    await writeFixtureFile('q2pro64.exe')
    await writeFixtureFile(join('baseq2', 'gamex86_64.dll'))
    await writeFixtureFile(join('baseq2', 'q2pro.menu'))
    await writeFixtureFile(join('baseq2', 'pak1.pak'))
    await writeFixtureFile(join('baseq2', 'pak2.pak'))
    await writeFixtureFile(join('baseq2', 'players', 'somefile'))
    await writeFixtureFile(join('ctf', 'pak0.pak'))
    await writeFixtureFile(join('ctf', 'ctf1.bsp'))
    await writeFixtureFile(join('xatrix', 'pak0.pak'))
    await writeFixtureFile(join('rogue', 'pak0.pak'))

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: true,
    })

    expect(result.copiedFiles.sort()).toEqual(
      [
        'baseq2/pak0.pak',
        'baseq2/pak1.pak',
        'baseq2/pak2.pak',
        'baseq2/gamex86_64.dll',
        'baseq2/q2pro.menu',
        Q2PRO_ENGINE_TARGET,
        join('baseq2', 'players', 'somefile'),
      ].sort(),
    )

    const topLevel = await namesUnder(targetRoot)
    expect(topLevel).not.toContain('ctf')
    expect(topLevel).not.toContain('xatrix')
    expect(topLevel).not.toContain('rogue')
    expect(await namesUnder(join(targetRoot, 'ctf'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'xatrix'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'rogue'))).toEqual([])
  })

  it('the engine binary lands as q2pro.exe whatever the zip calls it', async () => {
    // Source dir has q2pro64.exe at its root (not q2pro.exe) - exactly the real engine zip's layout.
    await writeFixtureFile('q2pro64.exe')

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: false,
    })

    expect(result.copiedFiles).toContain(Q2PRO_ENGINE_TARGET)
    expect(await namesUnder(targetRoot)).toContain(Q2PRO_ENGINE_TARGET)
  })

  it('a source set without pak0 reports the demo role as missing required', async () => {
    // Same "real layout" fixture as above, minus pak0.pak entirely - neither the
    // baseq2/pak0.pak nor the Install/Data/baseq2/pak0.pak candidate exists anywhere.
    await writeFixtureFile('q2pro64.exe')
    await writeFixtureFile(join('baseq2', 'gamex86_64.dll'))
    await writeFixtureFile(join('baseq2', 'pak1.pak'))
    await writeFixtureFile(join('baseq2', 'pak2.pak'))

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: false,
    })

    const plan = buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers: false })
    const pak0Entry = plan.find((entry) => entry.to === 'baseq2/pak0.pak')
    if (!pak0Entry) throw new Error('expected the plan to contain a baseq2/pak0.pak entry')

    expect(result.missingRequired).toEqual([{ role: 'demo', from: pak0Entry.from }])
    expect(pak0Entry.from).toEqual(['baseq2/pak0.pak', 'Install/Data/baseq2/pak0.pak'])

    // Every other required file still copied, and none of them show up as missing.
    expect(result.copiedFiles.sort()).toEqual(
      [
        'baseq2/gamex86_64.dll',
        'baseq2/pak1.pak',
        'baseq2/pak2.pak',
        Q2PRO_ENGINE_TARGET,
      ].sort(),
    )
    expect(result.copiedFiles).not.toContain('baseq2/pak0.pak')
  })

  it('players comes from baseq2/players and a missing video/ is a normal outcome', async () => {
    await writeFixtureFile(join('baseq2', 'players', 'x.dm2'))
    // Deliberately no video/ anywhere in the source tree.

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: true,
    })

    expect(result.copiedFiles).toContain(join('baseq2', 'players', 'x.dm2'))
    expect(await namesUnder(join(targetRoot, 'baseq2', 'players'))).toEqual(['x.dm2'])
    // Normal success - no video/ anywhere is not an error, and there's nothing to assert failed:
    // the promise above already resolved without throwing.
    expect(await namesUnder(join(targetRoot, 'baseq2', 'video'))).toEqual([])
  })

  it('every allowlist entry is reported as found or not found, with the source that served it', async () => {
    await seedExtractionTree()
    await seedVideoAndPlayers()

    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: true,
    })

    // One record per allowlist entry (plan order), plus one per glob dir - never one per file
    // inside a glob dir, even though seedVideoAndPlayers() writes multiple files into each.
    expect(result.entries).toEqual([
      { from: 'baseq2/pak0.pak', to: 'baseq2/pak0.pak', found: true, sourcePackageId: 'core' },
      { from: 'baseq2/pak1.pak', to: 'baseq2/pak1.pak', found: true, sourcePackageId: 'core' },
      { from: 'baseq2/pak2.pak', to: 'baseq2/pak2.pak', found: true, sourcePackageId: 'core' },
      { from: 'q2pro.exe', to: Q2PRO_ENGINE_TARGET, found: true, sourcePackageId: 'core' },
      {
        from: 'baseq2/gamex86_64.dll',
        to: 'baseq2/gamex86_64.dll',
        found: true,
        sourcePackageId: 'core',
      },
      {
        from: 'baseq2/q2pro.menu',
        to: 'baseq2/q2pro.menu',
        found: true,
        sourcePackageId: 'core',
      },
      { from: 'baseq2/players', to: 'baseq2/players', found: true, sourcePackageId: 'core' },
      { from: 'baseq2/video', to: 'baseq2/video', found: true, sourcePackageId: 'core' },
    ])
  })

  it('a run that finds nothing reports every entry as missing', async () => {
    // sourceRoot exists but is empty - no fixture files were written into it.
    const result = await assembleInstallation({
      sources: allRoleSources(sourceRoot),
      targetRoot,
      engine: 'q2pro',
      includeVideoAndPlayers: true,
    })

    expect(result.entries).toEqual([
      // Story 078 review finding M3: a not-found entry with more than one candidate records every
      // candidate that was tried (joined by ` | `), not just the first - so this table can tell
      // "the archive's real layout doesn't match any candidate" from "only one path was ever tried".
      { from: 'baseq2/pak0.pak | Install/Data/baseq2/pak0.pak', to: 'baseq2/pak0.pak', found: false },
      { from: 'baseq2/pak1.pak', to: 'baseq2/pak1.pak', found: false },
      { from: 'baseq2/pak2.pak', to: 'baseq2/pak2.pak', found: false },
      { from: 'q2pro.exe | q2pro64.exe', to: Q2PRO_ENGINE_TARGET, found: false },
      { from: 'baseq2/gamex86_64.dll', to: 'baseq2/gamex86_64.dll', found: false },
      { from: 'baseq2/q2pro.menu', to: 'baseq2/q2pro.menu', found: false },
      { from: 'baseq2/players', to: 'baseq2/players', found: false },
      { from: 'baseq2/video', to: 'baseq2/video', found: false },
    ])
    expect(result.copiedFiles).toEqual([])
  })
})

/**
 * Story 080 D2 (AC1/AC3/AC5/AC7): R1Q2 is a second, engine-specific block, and `findSource` now
 * refuses to satisfy an `engine`-role entry from a non-`engine` source - even one that happens to
 * contain a file at the very same relative path.
 */
describe('buildAssemblePlan (r1q2)', () => {
  const R1Q2_ENGINE_TARGET =
    ENGINE_DEFINITIONS.find((engine) => engine.kind === 'r1q2')?.executables[0] ?? 'r1q2.exe'

  it('produces exactly the three required r1q2 entries and none of the q2pro ones', () => {
    const plan = buildAssemblePlan({ engine: 'r1q2', includeVideoAndPlayers: false })
    const engineEntries = plan.filter((entry) => entry.role === 'engine')

    expect(engineEntries).toEqual([
      { from: ['r1q2.exe'], to: R1Q2_ENGINE_TARGET, role: 'engine', required: true },
      { from: ['ref_r1gl.dll'], to: 'ref_r1gl.dll', role: 'engine', required: true },
      { from: ['baseq2/gamex86.dll'], to: 'baseq2/gamex86.dll', role: 'engine', required: true },
    ])
    // The game-data entries (demo, point-release) are still there - engine-independent.
    expect(plan.map((entry) => entry.to).sort()).toEqual(
      [
        'baseq2/pak0.pak',
        'baseq2/pak1.pak',
        'baseq2/pak2.pak',
        'r1q2.exe',
        'ref_r1gl.dll',
        'baseq2/gamex86.dll',
      ].sort(),
    )
    // Never any q2pro-only path.
    for (const entry of plan) {
      for (const candidate of entry.from) {
        expect(candidate).not.toBe('q2pro.exe')
        expect(candidate).not.toBe('q2pro64.exe')
      }
      expect(entry.to).not.toBe('baseq2/gamex86_64.dll')
      expect(entry.to).not.toBe('baseq2/q2pro.menu')
    }
  })

  it("AC5: a same-path file in the point-release source cannot satisfy the engine's required DLL", async () => {
    // The point-release source really does contain a file at `baseq2/gamex86.dll` - engine-role's
    // exact required path - but it comes from the wrong package. No `role: 'engine'` source exists
    // at all, so the entry must be reported missing rather than silently satisfied by the
    // point-release extraction.
    await writeFixtureFile('r1q2.exe')
    await writeFixtureFile('ref_r1gl.dll')

    const otherSourceRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-assemble-pr-'))
    try {
      await mkdir(join(otherSourceRoot, 'baseq2'), { recursive: true })
      await writeFile(join(otherSourceRoot, 'baseq2', 'gamex86.dll'), 'wrong-package')
      await writeFile(join(otherSourceRoot, 'baseq2', 'pak1.pak'), 'data')
      await writeFile(join(otherSourceRoot, 'baseq2', 'pak2.pak'), 'data')

      const result = await assembleInstallation({
        sources: [
          { packageId: 'engine-partial', dir: sourceRoot, role: 'engine' },
          { packageId: 'point-release', dir: otherSourceRoot, role: 'point-release' },
        ],
        targetRoot,
        engine: 'r1q2',
        includeVideoAndPlayers: false,
      })

      expect(result.missingRequired).toContainEqual({
        role: 'engine',
        from: ['baseq2/gamex86.dll'],
      })
      expect(result.copiedFiles).not.toContain('baseq2/gamex86.dll')
      // Confirms the point-release file really was there and really was refused, not merely absent.
      expect(await namesUnder(join(targetRoot, 'baseq2'))).not.toContain('gamex86.dll')
    } finally {
      await rm(otherSourceRoot, { recursive: true, force: true })
    }
  })
})

/**
 * Story 088 D3 (AC4/AC7): the `'store-copy'` data source's game-data block. Named per the story's
 * "Acceptance Tests" table: "a store-copy plan copies baseq2 only, never ctf, xatrix or rogue".
 * `writeFixtureFileOfSize` (unlike `writeFixtureFile` above) writes an exact byte count, since the
 * pak2.pak gate is size-based, not content-based.
 */
async function writeFixtureFileOfSize(relativePath: string, size: number): Promise<void> {
  const path = join(sourceRoot, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, Buffer.alloc(size))
}

/** A fixture "store installation" tree: the retail block plus everything AC7 forbids. */
async function seedRetailSourceTree(pak2SizeBytes = RETAIL_PAK_SIZES['pak2.pak']): Promise<void> {
  await writeFixtureFileOfSize(join('baseq2', 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
  await writeFixtureFileOfSize(join('baseq2', 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  await writeFixtureFileOfSize(join('baseq2', 'pak2.pak'), pak2SizeBytes)
  await writeFixtureFile(join('baseq2', 'pak3.pak'))
  await writeFixtureFile('loose-file.txt')

  // Never on the allowlist - AC7's negative proof, same shape as the demo/point-release suite above.
  await writeFixtureFile(join('ctf', 'pak0.pak'))
  await writeFixtureFile(join('xatrix', 'pak0.pak'))
  await writeFixtureFile(join('rogue', 'pak0.pak'))
}

function retailSource(dir: string, packageId = 'retail-source'): AssembleSource[] {
  return [{ packageId, dir, role: 'retail' }]
}

describe('buildAssemblePlan (store-copy)', () => {
  it('contains only the three retail entries, no demo or point-release entry', () => {
    const plan = buildAssemblePlan({ includeVideoAndPlayers: false, dataSource: 'store-copy' })

    expect(plan.map((entry) => entry.to).sort()).toEqual(
      ['baseq2/pak0.pak', 'baseq2/pak1.pak', 'baseq2/pak2.pak'].sort(),
    )
    for (const entry of plan) {
      expect(entry.role).toBe('retail')
    }
    const byTo = new Map(plan.map((entry) => [entry.to, entry]))
    expect(byTo.get('baseq2/pak0.pak')).toMatchObject({ required: true })
    expect(byTo.get('baseq2/pak1.pak')).toMatchObject({ required: true })
    expect(byTo.get('baseq2/pak2.pak')).toMatchObject({
      required: false,
      expectedSizeBytes: RETAIL_PAK_SIZES['pak2.pak'],
    })
  })

  it('omits engine-role entries entirely when no engine is given', () => {
    const plan = buildAssemblePlan({ includeVideoAndPlayers: false, dataSource: 'store-copy' })
    expect(plan.some((entry) => entry.role === 'engine')).toBe(false)
  })

  it('the pre-existing free-download plan is unchanged by this story', () => {
    const withDefault = buildAssemblePlan({ engine: 'q2pro', includeVideoAndPlayers: false })
    const withExplicitDataSource = buildAssemblePlan({
      engine: 'q2pro',
      includeVideoAndPlayers: false,
      dataSource: 'free-download',
    })

    expect(withDefault).toEqual(withExplicitDataSource)
    expect(withDefault.map((e) => e.to).sort()).toEqual(
      [
        'baseq2/gamex86_64.dll',
        'baseq2/pak0.pak',
        'baseq2/pak1.pak',
        'baseq2/pak2.pak',
        'baseq2/q2pro.menu',
        Q2PRO_ENGINE_TARGET,
      ].sort(),
    )
    expect(withDefault.every((entry) => entry.role !== 'retail')).toBe(true)
  })
})

describe('assembleInstallation (store-copy)', () => {
  it('a store-copy plan copies baseq2 only, never ctf, xatrix or rogue', async () => {
    await seedRetailSourceTree()

    const result = await assembleInstallation({
      sources: retailSource(sourceRoot),
      targetRoot,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })

    expect(result.copiedFiles.sort()).toEqual(
      ['baseq2/pak0.pak', 'baseq2/pak1.pak', 'baseq2/pak2.pak'].sort(),
    )
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual(
      ['pak0.pak', 'pak1.pak', 'pak2.pak'].sort(),
    )
    expect(await namesUnder(targetRoot)).toEqual(['baseq2'])

    // Negative: nothing else ever lands at the target, including pak3/loose files that were
    // never on the allowlist to begin with.
    const topLevel = await namesUnder(targetRoot)
    expect(topLevel).not.toContain('ctf')
    expect(topLevel).not.toContain('xatrix')
    expect(topLevel).not.toContain('rogue')
    expect(topLevel).not.toContain('loose-file.txt')
    expect(await namesUnder(join(targetRoot, 'baseq2'))).not.toContain('pak3.pak')
  })

  it('a wrong-size pak2.pak is skipped while pak0/pak1 still copy', async () => {
    await seedRetailSourceTree(RETAIL_PAK_SIZES['pak2.pak'] - 1)

    const result = await assembleInstallation({
      sources: retailSource(sourceRoot),
      targetRoot,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })

    expect(result.copiedFiles.sort()).toEqual(['baseq2/pak0.pak', 'baseq2/pak1.pak'].sort())
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual(['pak0.pak', 'pak1.pak'].sort())
    expect(result.missingRequired).toEqual([])

    const pak2Entry = result.entries.find((entry) => entry.to === 'baseq2/pak2.pak')
    expect(pak2Entry?.found).toBe(false)
  })

  it('a missing pak2.pak is a normal, non-required outcome', async () => {
    await writeFixtureFileOfSize(join('baseq2', 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
    await writeFixtureFileOfSize(join('baseq2', 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])

    const result = await assembleInstallation({
      sources: retailSource(sourceRoot),
      targetRoot,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })

    expect(result.copiedFiles.sort()).toEqual(['baseq2/pak0.pak', 'baseq2/pak1.pak'].sort())
    expect(result.missingRequired).toEqual([])
  })

  it('the video/players toggle: off leaves them out, on brings them in', async () => {
    await seedRetailSourceTree()
    await writeFixtureFile(join('baseq2', 'video', 'idlog.cin'))
    await writeFixtureFile(join('baseq2', 'players', 'male', 'skin.pcx'), 'skin')

    const off = await assembleInstallation({
      sources: retailSource(sourceRoot),
      targetRoot,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })
    expect(off.copiedFiles).not.toContain(join('baseq2', 'video', 'idlog.cin'))
    expect(await namesUnder(join(targetRoot, 'baseq2', 'video'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'baseq2', 'players'))).toEqual([])

    const otherTargetRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-assemble-dst2-'))
    try {
      const on = await assembleInstallation({
        sources: retailSource(sourceRoot),
        targetRoot: otherTargetRoot,
        includeVideoAndPlayers: true,
        dataSource: 'store-copy',
      })
      expect(on.copiedFiles).toContain(join('baseq2', 'video', 'idlog.cin'))
      expect(await namesUnder(join(otherTargetRoot, 'baseq2', 'video'))).toEqual(['idlog.cin'])
      expect(await namesUnder(join(otherTargetRoot, 'baseq2', 'players'))).toEqual(['male'])
    } finally {
      await rm(otherTargetRoot, { recursive: true, force: true })
    }
  })

  it('a required entry missing from a store-copy source is reported, role retail', async () => {
    await writeFixtureFileOfSize(join('baseq2', 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
    // pak0.pak deliberately absent.

    const result = await assembleInstallation({
      sources: retailSource(sourceRoot),
      targetRoot,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })

    expect(result.missingRequired).toEqual([{ role: 'retail', from: ['baseq2/pak0.pak'] }])
  })

  it('resolves a retail source case-insensitively, matching inspectRetailSource (review F2)', async () => {
    // Traditional Quake II folders are spelled `Baseq2/PAK0.PAK` - `inspectRetailSource`
    // (`retail-source.ts`) already resolves that case-insensitively, so a source that verified
    // during inspection and `verifyCopySource`'s re-check must copy the exact same way. Before the
    // fix, `findSource` resolved `role: 'retail'` candidates with a case-sensitive `join` + `stat`,
    // which would find nothing on a case-sensitive filesystem (Linux/macOS runners) even though the
    // path was already confirmed to exist under a different case.
    await mkdir(join(sourceRoot, 'Baseq2'), { recursive: true })
    await writeFile(join(sourceRoot, 'Baseq2', 'PAK0.PAK'), 'pak0')
    await writeFile(join(sourceRoot, 'Baseq2', 'PAK1.PAK'), 'pak1')

    const result = await assembleInstallation({
      sources: retailSource(sourceRoot),
      targetRoot,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })

    expect(result.missingRequired).toEqual([])
    expect(result.copiedFiles.sort()).toEqual(['baseq2/pak0.pak', 'baseq2/pak1.pak'].sort())
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual(['pak0.pak', 'pak1.pak'].sort())
  })
})
