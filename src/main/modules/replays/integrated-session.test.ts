import { execFileSync } from 'node:child_process'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { replaysIntegratedPrepareSchema, type DiscoveredDemo } from '@shared/modules/replays'
import { installTempDir } from '../../../test-support/temp-dir'
import { unwrapOk } from '../../../test-support/outcome'
import { resolveExtractorPath } from '../../lib/archive/7za-path'
import { demo, installation } from './demo-play.test-helpers'
import { createIntegratedSession, type IntegratedManifest } from './integrated-session'

const realBinary = resolveExtractorPath({ isPackaged: false })
const tempDir = installTempDir('q2-launcher-integrated-')

const CTF_DEMO = demo({
  id: 'd1',
  fileName: 'match.dm2',
  gameDir: 'ctf',
  source: { kind: 'installation', installationId: 'q2', installationName: 'Q2', gameDir: 'ctf' },
})

async function put(path: string, content: string | Buffer = 'x'): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  return path
}

/** An installation with mixed-case folders and files, a `ctf` mod and one demo in it. */
async function fixture(): Promise<{ root: string; home: string; demoPath: string }> {
  const base = await realpath(tempDir())
  const root = join(base, 'Quake2')
  await put(join(root, 'BaseQ2', 'PAK0.PAK'), 'base-pak-0')
  await put(join(root, 'BaseQ2', 'pak1.pak'), 'base-pak-1')
  await put(join(root, 'BaseQ2', 'notes.txt'))
  await put(join(root, 'BaseQ2', 'Maps', 'base1.bsp'))
  await put(join(root, 'Ctf', 'PAK0.PAK'), 'ctf-pak')
  await put(join(root, 'Ctf', 'Extra.PKZ'), 'pkz')
  await put(join(root, 'Ctf', 'other.pak'))
  await put(join(root, 'Ctf', 'readme.txt'))
  await put(join(root, 'Ctf', 'Maps', 'Q2CTF1.BSP'), 'ctf-map')
  await put(join(root, 'Ctf', 'Maps', 'Sub', 'Deep.bsp'))
  await put(join(root, 'Ctf', 'textures', 'e1u1', 'WALL.wal'))
  await put(join(root, 'Ctf', 'Config', 'server.cfg'))
  // A real file outside the installation, for a faked link to point at.
  await put(join(base, 'elsewhere', 'WALL.wal'))
  await put(join(base, 'elsewhere', 'PAK0.PAK'))
  const demoPath = await put(join(root, 'Ctf', 'demos', 'match.dm2'), 'demo-bytes')
  return { root, home: join(base, 'home'), demoPath }
}

const CTF_VPATHS = [
  'baseq2/pak0.pak',
  'baseq2/pak1.pak',
  'ctf/extra.pkz',
  'ctf/maps/q2ctf1.bsp',
  'ctf/maps/sub/deep.bsp',
  'ctf/pak0.pak',
  'ctf/textures/e1u1/wall.wal',
]

interface SessionSetup {
  root: string
  home?: string
  demos?: DiscoveredDemo[]
  files?: Record<string, { absolutePath: string; archiveEntry: DiscoveredDemo['archiveEntry'] }>
  platform?: NodeJS.Platform
  active?: string
  limitBytes?: number
  readDemos?: () => Promise<readonly DiscoveredDemo[]>
}

function session(setup: SessionSetup) {
  const fs = {
    realpath: vi.fn((p: string) => realpath(p)),
    stat: vi.fn((p: string) => stat(p)),
  }
  let tokens = 0
  const demos = setup.demos ?? [CTF_DEMO]
  const files = setup.files ?? {
    d1: { absolutePath: join(setup.root, 'Ctf', 'demos', 'match.dm2'), archiveEntry: null },
  }
  const s = createIntegratedSession({
    readDemos: setup.readDemos ?? (async () => demos),
    resolveFile: (id) => files[id],
    installations: () => [installation({ id: 'q2', rootPath: setup.root })],
    activeInstallationId: () => setup.active ?? 'q2',
    discoveryContext: () => ({
      platform: setup.platform ?? 'win32',
      homeDir: setup.home ?? join(setup.root, '..', 'home'),
      zipDeps: { extractorPath: realBinary.path, extractorExists: realBinary.exists },
    }),
    fs,
    randomUUID: () => `tok-${++tokens}`,
    ...(setup.limitBytes !== undefined ? { limitBytes: setup.limitBytes } : {}),
  })
  return { s, fs }
}

function indexOf(manifest: IntegratedManifest, vpath: string): number {
  const entry = manifest.files.find((f) => f.vpath === vpath)
  if (!entry) throw new Error(`no ${vpath} in the manifest`)
  return entry.index
}

describe('preparing an integrated session', () => {
  it('prepare returns a token, the game dir and an indexed manifest for a demo of the active installation', async () => {
    const { root } = await fixture()
    const { s } = session({ root })
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    expect(manifest.token).toBe('tok-1')
    expect(manifest.gameDir).toBe('ctf')
    expect(manifest.files.map((f) => f.index)).toEqual(CTF_VPATHS.map((_, i) => i))
    expect(manifest.files[indexOf(manifest, 'baseq2/pak0.pak')].size).toBe('base-pak-0'.length)
    expect(manifest.demo).toEqual({
      index: CTF_VPATHS.length,
      vpath: 'ctf/demos/_launcher/d1.dm2',
      size: 'demo-bytes'.length,
    })
  })

  it('every vpath is a lower-case relative Quake path', async () => {
    const { root } = await fixture()
    const manifest = unwrapOk<IntegratedManifest>(await session({ root }).s.prepare('d1', 'q2'))
    for (const { vpath } of [...manifest.files, manifest.demo]) {
      expect(vpath).toBe(vpath.toLowerCase())
      expect(vpath).toMatch(/^[^/\\:]+(\/[^/\\:]+)+$/)
      expect(vpath.split('/')).not.toContain('..')
    }
  })

  it('the manifest holds the paks of baseq2 and the game dir and the loose files of its asset folders, whatever their case', async () => {
    const { root } = await fixture()
    const manifest = unwrapOk<IntegratedManifest>(await session({ root }).s.prepare('d1', 'q2'))
    expect(manifest.files.map((f) => f.vpath)).toEqual(CTF_VPATHS)
  })

  it('game data over the limit is refused with its size in MB', async () => {
    const { root } = await fixture()
    await put(join(root, 'Ctf', 'pak2.pak'), Buffer.alloc(2 * 2 ** 20 + 1))
    const { s } = session({ root, limitBytes: 2 ** 20 })
    expect(await s.prepare('d1', 'q2')).toEqual({
      ok: false,
      error: { key: 'replays.integrated.error.dataTooLarge', params: { sizeMb: 3 } },
    })
    expect(await s.resolve('tok-1', 0)).toBeNull()
  })

  it('a write dir file wins a vpath collision over the installation', async () => {
    const { root, home } = await fixture()
    const shadow = await put(join(home, '.q2pro', 'ctf', 'maps', 'q2ctf1.bsp'), 'shadowing-map')
    const { s } = session({ root, home, platform: 'linux' })
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    expect(manifest.files.map((f) => f.vpath)).toEqual(CTF_VPATHS)
    expect(await s.resolve(manifest.token, indexOf(manifest, 'ctf/maps/q2ctf1.bsp'))).toEqual({
      kind: 'file',
      path: await realpath(shadow),
      size: 'shadowing-map'.length,
    })
  })

  it('a file whose realpath is outside its root is left out', async () => {
    const { root } = await fixture()
    const { s, fs } = session({ root })
    fs.realpath.mockImplementation(async (p: string) =>
      p.endsWith('WALL.wal') ? join(root, '..', 'elsewhere', 'WALL.wal') : realpath(p),
    )
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    expect(manifest.files.map((f) => f.vpath)).not.toContain('ctf/textures/e1u1/wall.wal')
  })

  it('an mvd2 demo or an installation that is not the active one is refused', async () => {
    const { root } = await fixture()
    const mvd = { ...CTF_DEMO, format: 'mvd2' as const }
    expect(await session({ root, demos: [mvd] }).s.prepare('d1', 'q2')).toEqual({
      ok: false,
      error: { key: 'replays.player.unavailable.mvd2Integrated' },
    })
    expect(await session({ root, active: 'other' }).s.prepare('d1', 'q2')).toEqual({
      ok: false,
      error: { key: 'replays.play.unavailable.unsupportedEngine' },
    })
  })
})

describe('resolving a manifest index', () => {
  it.skipIf(!realBinary.exists)(
    'a zip-entry demo resolves to its unpacked bytes and a .gz demo to its own file',
    async () => {
      const { root } = await fixture()
      const zipSrc = join(root, '..', 'zip-src')
      await put(join(zipSrc, 'inner.dm2'), 'zipped-demo')
      const archive = join(root, '..', 'pack.zip')
      execFileSync(realBinary.path, ['a', '-tzip', '-y', '-spd', '--', archive, 'inner.dm2'], {
        cwd: zipSrc,
      })
      const gzPath = await put(join(root, 'Ctf', 'demos', 'g.dm2.gz'), 'gz-bytes')
      const zipped = { ...CTF_DEMO, id: 'z1', fileName: 'inner.dm2' }
      const gz = { ...CTF_DEMO, id: 'g1', fileName: 'g.dm2.gz', gzip: true }
      const { s } = session({
        root,
        demos: [zipped, gz],
        files: {
          z1: {
            absolutePath: archive,
            archiveEntry: { archivePath: archive, entryPath: 'inner.dm2' },
          },
          g1: { absolutePath: gzPath, archiveEntry: null },
        },
      })

      const z = unwrapOk<IntegratedManifest>(await s.prepare('z1', 'q2'))
      expect(z.demo.vpath).toBe('ctf/demos/_launcher/z1.dm2')
      const unpacked = await s.resolve(z.token, z.demo.index)
      if (unpacked?.kind !== 'bytes') throw new Error('the zip-entry demo did not resolve to bytes')
      expect(Buffer.from(unpacked.bytes).toString()).toBe('zipped-demo')
      expect(unpacked.size).toBe('zipped-demo'.length)

      const g = unwrapOk<IntegratedManifest>(await s.prepare('g1', 'q2'))
      expect(g.demo.vpath).toBe('ctf/demos/_launcher/g1.dm2.gz')
      expect(await s.resolve(g.token, g.demo.index)).toEqual({
        kind: 'file',
        path: await realpath(gzPath),
        size: 'gz-bytes'.length,
      })
    },
  )

  it('an unknown or stale token or an index outside the manifest resolves to nothing without touching the file system', async () => {
    const { root } = await fixture()
    const { s, fs } = session({ root })
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    fs.realpath.mockClear()
    fs.stat.mockClear()

    expect(await s.resolve('unknown', 0)).toBeNull()
    expect(await s.resolve(manifest.token, -1)).toBeNull()
    expect(await s.resolve(manifest.token, manifest.demo.index + 1)).toBeNull()
    expect(await s.resolve(manifest.token, 0.5)).toBeNull()
    s.release(manifest.token)
    expect(await s.resolve(manifest.token, 0)).toBeNull()
    expect(fs.realpath).not.toHaveBeenCalled()
    expect(fs.stat).not.toHaveBeenCalled()
  })

  it('a file whose realpath changed after prepare resolves to nothing', async () => {
    const { root } = await fixture()
    const { s, fs } = session({ root })
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    const index = indexOf(manifest, 'ctf/pak0.pak')
    expect(await s.resolve(manifest.token, index)).toEqual({
      kind: 'file',
      path: join(root, 'Ctf', 'PAK0.PAK'),
      size: 'ctf-pak'.length,
    })

    // A swapped link: the manifest path now leads somewhere else.
    fs.realpath.mockResolvedValue(join(root, '..', 'elsewhere', 'PAK0.PAK'))
    expect(await s.resolve(manifest.token, index)).toBeNull()
  })

  it('resolve opens the realpath pinned at prepare, not the manifest path', async () => {
    const { root } = await fixture()
    const manifestPath = join(root, 'Ctf', 'PAK0.PAK')
    const target = await put(join(root, 'Ctf', 'linked-target.bin'), 'ctf-pak')
    const { s, fs } = session({ root })
    // The manifest path is a link to a different file inside the root, consistently.
    fs.realpath.mockImplementation(async (p: string) => (p === manifestPath ? target : realpath(p)))
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    const resolved = await s.resolve(manifest.token, indexOf(manifest, 'ctf/pak0.pak'))
    expect(resolved).toEqual({ kind: 'file', path: target, size: 'ctf-pak'.length })
    expect(resolved).not.toMatchObject({ path: manifestPath })
  })

  it('a release while resolve is checking the file resolves to nothing', async () => {
    const { root } = await fixture()
    const { s, fs } = session({ root })
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    let openGate: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    fs.realpath.mockImplementation(async (p: string) => {
      await gate
      return realpath(p)
    })
    const pending = s.resolve(manifest.token, indexOf(manifest, 'ctf/pak0.pak'))
    s.release(manifest.token)
    openGate()
    expect(await pending).toBeNull()
  })

  it('a file whose size changed after prepare resolves to nothing', async () => {
    const { root } = await fixture()
    const { s } = session({ root })
    const manifest = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    await writeFile(join(root, 'Ctf', 'PAK0.PAK'), 'a longer pak than before')
    expect(await s.resolve(manifest.token, indexOf(manifest, 'ctf/pak0.pak'))).toBeNull()
  })
})

describe('the session token', () => {
  it('a release or a new prepare invalidates the previous token', async () => {
    const { root } = await fixture()
    const { s } = session({ root })
    const first = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    expect(s.release('someone-else')).toEqual({ ok: true, value: undefined })
    expect(await s.resolve(first.token, 0)).not.toBeNull()
    s.release(first.token)
    expect(await s.resolve(first.token, 0)).toBeNull()

    const second = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    const third = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    expect(await s.resolve(second.token, 0)).toBeNull()
    expect(await s.resolve(third.token, 0)).not.toBeNull()
  })

  it('a prepare that finishes after a later one never installs its token', async () => {
    const { root } = await fixture()
    let openGate: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    const readDemos = vi
      .fn<() => Promise<readonly DiscoveredDemo[]>>()
      .mockImplementationOnce(async () => {
        await gate
        return [CTF_DEMO]
      })
      .mockImplementation(async () => [CTF_DEMO])
    const { s } = session({ root, readDemos })

    const slow = s.prepare('d1', 'q2')
    const fast = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    openGate()
    const late = await slow
    expect(late.ok).toBe(false)
    expect(await s.resolve(fast.token, 0)).not.toBeNull()
  })

  it('a refused prepare leaves no token behind', async () => {
    const { root } = await fixture()
    const { s } = session({ root })
    const first = unwrapOk<IntegratedManifest>(await s.prepare('d1', 'q2'))
    expect((await s.prepare('missing', 'q2')).ok).toBe(false)
    expect(await s.resolve(first.token, 0)).toBeNull()
  })
})

describe('integrated prepare payload', () => {
  it('the prepare payload takes no path', () => {
    const valid = { demoId: 'd1', installationId: 'q2' }
    expect(replaysIntegratedPrepareSchema.safeParse(valid).success).toBe(true)
    expect(replaysIntegratedPrepareSchema.safeParse({ ...valid, path: 'C:/x' }).success).toBe(false)
  })
})
