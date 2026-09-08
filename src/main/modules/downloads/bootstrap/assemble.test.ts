import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleInstallation, buildAssemblePlan } from './assemble'

/**
 * Story 074 D3. AC8 is a hard negative requirement: the 3.20 point-release package's extraction
 * also contains a `ctf/` payload that must never land in the assembled `baseq2` installation,
 * alongside `xatrix/`/`rogue/` from other real-world Q2 archives. The mechanism is an allowlist,
 * not a filter, so this suite's job is to prove the *absence* of everything not on the list, not
 * merely the presence of what is - a filter-shaped bug (e.g. an accidental recursive copy) would
 * still pass a presence-only assertion.
 */

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
  await writeFixtureFile(join('baseq2', 'pak2.pak'))
  await writeFixtureFile('q2pro.exe')
  await writeFixtureFile(join('baseq2', 'gamex86_64.dll'))

  // Never on the allowlist - AC8's negative proof.
  await writeFixtureFile(join('ctf', 'pak0.pak'))
  await writeFixtureFile(join('ctf', 'ctf1.bsp'))
  await writeFixtureFile(join('xatrix', 'pak0.pak'))
  await writeFixtureFile(join('rogue', 'pak0.pak'))
}

async function seedVideoAndPlayers(): Promise<void> {
  await writeFixtureFile(join('video', 'idlog.cin'))
  await writeFixtureFile(join('video', 'end.cin'))
  await writeFixtureFile(join('players', 'male', 'skin.pcx'), 'skin')
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
    expect(off.map((e) => e.to).sort()).toEqual([
      'baseq2/gamex86_64.dll',
      'baseq2/pak0.pak',
      'baseq2/pak2.pak',
      'q2pro.exe',
    ])
  })

  it('never plans a ctf/xatrix/rogue entry, whatever the toggle', () => {
    for (const includeVideoAndPlayers of [false, true]) {
      const plan = buildAssemblePlan({ includeVideoAndPlayers })
      for (const entry of plan) {
        expect(entry.from.startsWith('ctf')).toBe(false)
        expect(entry.from.startsWith('xatrix')).toBe(false)
        expect(entry.from.startsWith('rogue')).toBe(false)
      }
    }
  })
})

describe('assembleInstallation', () => {
  it('toggle off: copies exactly the allowlisted files, ctf/xatrix/rogue/video/players absent', async () => {
    await seedExtractionTree()
    await seedVideoAndPlayers()

    const result = await assembleInstallation({
      sourceDirs: [sourceRoot],
      targetRoot,
      includeVideoAndPlayers: false,
    })

    expect(result.copiedFiles.sort()).toEqual([
      'baseq2/gamex86_64.dll',
      'baseq2/pak0.pak',
      'baseq2/pak2.pak',
      'q2pro.exe',
    ])

    // Positive: the allowlisted files landed, including the engine's own game module DLL.
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual([
      'gamex86_64.dll',
      'pak0.pak',
      'pak2.pak',
    ])
    expect(await namesUnder(targetRoot)).toEqual(['baseq2', 'q2pro.exe'])

    // Negative (AC8's actual proof): nothing else exists under the target root at all.
    expect(await namesUnder(join(targetRoot, 'ctf'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'xatrix'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'rogue'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'video'))).toEqual([])
    expect(await namesUnder(join(targetRoot, 'players'))).toEqual([])
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
      sourceDirs: [sourceRoot],
      targetRoot,
      includeVideoAndPlayers: true,
    })

    expect(result.copiedFiles.sort()).toEqual(
      [
        'baseq2/gamex86_64.dll',
        'baseq2/pak0.pak',
        'baseq2/pak2.pak',
        'q2pro.exe',
        join('baseq2', 'video', 'idlog.cin'),
        join('baseq2', 'video', 'end.cin'),
        join('players', 'male'),
      ].sort(),
    )

    // Positive: the engine's own game module DLL landed alongside the paks, video/players did too.
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toContain('gamex86_64.dll')
    expect(await namesUnder(join(targetRoot, 'baseq2', 'video'))).toEqual(['end.cin', 'idlog.cin'])
    expect(await namesUnder(join(targetRoot, 'players'))).toEqual(['male'])
    expect(await namesUnder(join(targetRoot, 'players', 'male'))).toEqual(['skin.pcx'])

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
      await writeFixtureFile(join('baseq2', 'pak2.pak'))
      await writeFixtureFile('q2pro.exe')

      const result = await assembleInstallation({
        sourceDirs: [sourceRoot, otherSourceRoot],
        targetRoot,
        includeVideoAndPlayers: false,
      })

      expect(result.copiedFiles.sort()).toEqual(['baseq2/pak0.pak', 'baseq2/pak2.pak', 'q2pro.exe'])
      expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual(['pak0.pak', 'pak2.pak'])
    } finally {
      await rm(otherSourceRoot, { recursive: true, force: true })
    }
  })

  it('does not throw when an allowlisted file is missing, and reports only what was copied', async () => {
    // Only q2pro.exe present - the paks are missing entirely.
    await writeFixtureFile('q2pro.exe')

    const result = await assembleInstallation({
      sourceDirs: [sourceRoot],
      targetRoot,
      includeVideoAndPlayers: false,
    })

    expect(result.copiedFiles).toEqual(['q2pro.exe'])
    expect(await namesUnder(join(targetRoot, 'baseq2'))).toEqual([])
  })
})
