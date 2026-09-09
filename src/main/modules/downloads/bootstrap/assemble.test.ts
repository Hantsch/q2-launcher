import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENGINE_DEFINITIONS } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleInstallation, buildAssemblePlan } from './assemble'

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

describe('buildAssemblePlan (pure)', () => {
  it('the fixed allowlist entries do not depend on the toggle', () => {
    const off = buildAssemblePlan({ includeVideoAndPlayers: false })
    const on = buildAssemblePlan({ includeVideoAndPlayers: true })

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
      const plan = buildAssemblePlan({ includeVideoAndPlayers })
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
    const plan = buildAssemblePlan({ includeVideoAndPlayers: false })
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
          { packageId: 'core', dir: sourceRoot },
          { packageId: 'other', dir: otherSourceRoot },
        ],
        targetRoot,
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
      includeVideoAndPlayers: false,
    })

    const plan = buildAssemblePlan({ includeVideoAndPlayers: false })
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
      sources: [{ packageId: 'core', dir: sourceRoot }],
      targetRoot,
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
