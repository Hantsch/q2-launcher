import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import { copyGameDataSource, inspectGameDataSource, isPathContainedBy } from './game-data-source'

/**
 * Story 089 D2. Proves AC3-AC7 at the core level: a hand-picked folder's `baseq2/pak0.pak`+
 * `pak1.pak` decide `kind` (`retail`/`demo`/`unusable`), extra payloads (`ctf`/`xatrix`/`rogue`,
 * loose files) never affect the verdict or leak into a copy, and an unsafe path never even gets its
 * contents read. Real temp dirs, same fixture style as `retail-source.test.ts`.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-game-data-source-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function writePakOfSize(baseq2: string, name: string, size: number): Promise<void> {
  await writeFile(join(baseq2, name), Buffer.alloc(size))
}

describe('inspectGameDataSource', () => {
  it('a source with pak0.pak and pak1.pak both at retail size verdicts retail', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])

    const verdict = await inspectGameDataSource(dir)

    expect(verdict.kind).toBe('retail')
    expect(verdict.reason).toBeUndefined()
    expect(verdict.paks.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'pak0.pak', sizeBytes: RETAIL_PAK_SIZES['pak0.pak'], retail: true },
      { name: 'pak1.pak', sizeBytes: RETAIL_PAK_SIZES['pak1.pak'], retail: true },
    ])
  })

  it('a wrong-size pak0.pak verdicts demo, not unusable', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'] - 1)

    const verdict = await inspectGameDataSource(dir)

    expect(verdict.kind).toBe('demo')
  })

  it('pak0.pak present but pak1.pak missing verdicts demo', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])

    const verdict = await inspectGameDataSource(dir)

    expect(verdict.kind).toBe('demo')
    expect(verdict.paks).toEqual([
      { name: 'pak0.pak', sizeBytes: RETAIL_PAK_SIZES['pak0.pak'], retail: true },
    ])
  })

  it('no pak0.pak at all verdicts unusable with pak0Missing', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })

    const verdict = await inspectGameDataSource(dir)

    expect(verdict.kind).toBe('unusable')
    expect(verdict.reason).toBe('bootstrap.gameDataSource.pak0Missing')
  })

  it('no baseq2 directory at all verdicts unusable with baseDirMissing', async () => {
    await mkdir(dir, { recursive: true })

    const verdict = await inspectGameDataSource(dir)

    expect(verdict.kind).toBe('unusable')
    expect(verdict.reason).toBe('bootstrap.gameDataSource.baseDirMissing')
  })

  it('a folder that does not exist at all verdicts unusable with rootMissing', async () => {
    const missing = join(dir, 'does-not-exist')

    const verdict = await inspectGameDataSource(missing)

    expect(verdict.kind).toBe('unusable')
    expect(verdict.reason).toBe('bootstrap.gameDataSource.rootMissing')
  })

  it('an unsafe path (a reserved device name) verdicts unusable without reading the folder', async () => {
    const unsafe = join(dir, 'NUL')

    const verdict = await inspectGameDataSource(unsafe)

    expect(verdict.kind).toBe('unusable')
    expect(verdict.reason).toBe('bootstrap.gameDataSource.unsafePath')
  })

  it('extra payloads (ctf/xatrix/rogue, loose files) alongside valid paks never affect the verdict', async () => {
    const baseq2 = join(dir, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writePakOfSize(baseq2, 'pak0.pak', RETAIL_PAK_SIZES['pak0.pak'])
    await writePakOfSize(baseq2, 'pak1.pak', RETAIL_PAK_SIZES['pak1.pak'])
    await mkdir(join(dir, 'ctf'), { recursive: true })
    await mkdir(join(dir, 'xatrix'), { recursive: true })
    await mkdir(join(dir, 'rogue'), { recursive: true })
    await writeFile(join(baseq2, 'readme.txt'), 'hello')

    const verdict = await inspectGameDataSource(dir)

    expect(verdict.kind).toBe('retail')
    expect(verdict.paks.map((pak) => pak.name).sort()).toEqual(['pak0.pak', 'pak1.pak'])
  })
})

describe('copyGameDataSource', () => {
  let sourceRoot: string
  let targetRoot: string

  beforeEach(async () => {
    sourceRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-game-data-copy-src-'))
    targetRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-game-data-copy-dst-'))
  })

  afterEach(async () => {
    await rm(sourceRoot, { recursive: true, force: true })
    await rm(targetRoot, { recursive: true, force: true })
  })

  it('copies pak0.pak and pak1.pak, reporting both in copied', async () => {
    const baseq2 = join(sourceRoot, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), 'pak0-content')
    await writeFile(join(baseq2, 'pak1.pak'), 'pak1-content')

    const result = await copyGameDataSource(sourceRoot, targetRoot)

    expect(result.copied.sort()).toEqual(['baseq2/pak0.pak', 'baseq2/pak1.pak'])
    expect(await readFile(join(targetRoot, 'baseq2', 'pak0.pak'), 'utf8')).toBe('pak0-content')
    expect(await readFile(join(targetRoot, 'baseq2', 'pak1.pak'), 'utf8')).toBe('pak1-content')
  })

  it('copies pak2.pak too when present', async () => {
    const baseq2 = join(sourceRoot, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), 'pak0-content')
    await writeFile(join(baseq2, 'pak1.pak'), 'pak1-content')
    await writeFile(join(baseq2, 'pak2.pak'), 'pak2-content')

    const result = await copyGameDataSource(sourceRoot, targetRoot)

    expect(result.copied.sort()).toEqual(['baseq2/pak0.pak', 'baseq2/pak1.pak', 'baseq2/pak2.pak'])
  })

  it('never copies ctf/xatrix/rogue or loose files outside the pak allowlist (AC7)', async () => {
    const baseq2 = join(sourceRoot, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), 'pak0-content')
    await writeFile(join(baseq2, 'pak1.pak'), 'pak1-content')
    await writeFile(join(baseq2, 'readme.txt'), 'hello')
    await mkdir(join(sourceRoot, 'ctf'), { recursive: true })
    await writeFile(join(sourceRoot, 'ctf', 'pak0.pak'), 'ctf-data')
    await mkdir(join(sourceRoot, 'xatrix'), { recursive: true })
    await mkdir(join(sourceRoot, 'rogue'), { recursive: true })

    await copyGameDataSource(sourceRoot, targetRoot)

    expect(await readdir(targetRoot)).toEqual(['baseq2'])
    expect((await readdir(join(targetRoot, 'baseq2'))).sort()).toEqual(['pak0.pak', 'pak1.pak'])
  })

  it('copies real, independent bytes - never a link', async () => {
    const baseq2 = join(sourceRoot, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), 'original-content')

    await copyGameDataSource(sourceRoot, targetRoot)
    const targetPath = join(targetRoot, 'baseq2', 'pak0.pak')

    const { lstat } = await import('node:fs/promises')
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(false)

    await writeFile(join(baseq2, 'pak0.pak'), 'mutated-after-copy')
    expect(await readFile(targetPath, 'utf8')).toBe('original-content')
  })

  it('creates baseq2/ at the target when it does not exist yet', async () => {
    const baseq2 = join(sourceRoot, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), 'pak0-content')

    await copyGameDataSource(sourceRoot, targetRoot)

    expect(await readdir(join(targetRoot, 'baseq2'))).toEqual(['pak0.pak'])
  })
})

describe('isPathContainedBy', () => {
  it('a target inside the source is contained', () => {
    const source = join(dir, 'source')
    const target = join(source, 'nested', 'target')
    expect(isPathContainedBy(target, source)).toBe(true)
  })

  it('a source inside the target is contained', () => {
    const target = join(dir, 'target')
    const source = join(target, 'nested', 'source')
    expect(isPathContainedBy(source, target)).toBe(true)
  })

  it('two unrelated paths are not contained', () => {
    const a = join(dir, 'alpha')
    const b = join(dir, 'beta')
    expect(isPathContainedBy(a, b)).toBe(false)
  })
})
