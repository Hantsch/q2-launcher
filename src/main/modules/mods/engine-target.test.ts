import { describe, expect, it } from 'vitest'
import type { BinaryArch } from '../../lib/fs-utils'
import type { ModCatalogEntryParsed } from './catalog-schema'
import { resolveEngineTarget, selectVariant, type EngineTarget } from './engine-target'

type Version = ModCatalogEntryParsed['versions'][number]

const pkg = (id: string) => ({
  id,
  version: '1',
  url: 'https://example.com/x.zip',
  mirrors: [],
  sizeBytes: 1,
  sha256: 'a'.repeat(64),
  contents: [{ from: '.', to: 'gamedir' as const }],
})

function version(variants: Version['variants'], contentOnly: string[] = ['content']): Version {
  return {
    version: '1.0',
    prerelease: false,
    variants,
    contentOnly: { packages: contentOnly.map(pkg) },
  }
}

const reading = (arch: BinaryArch) => async () => arch

describe('engine target and variant selection', () => {
  it('r1q2 on Windows selects the x86 library variant', async () => {
    const target = await resolveEngineTarget(
      { engineKind: 'r1q2', executablePath: 'C:\q2\r1q2.exe', executableKind: 'pe' },
      [],
      reading('x86'),
    )
    expect(target).toEqual({ platform: 'win32', arch: 'x86', engineKind: 'r1q2' })
    const v = version([
      { platform: 'win32', arch: 'x64', packages: [pkg('lib64')] },
      { platform: 'win32', arch: 'x86', packages: [pkg('lib32')] },
    ])
    const sel = selectVariant(v, target)
    expect(sel).toMatchObject({ contentOnly: false, variant: { arch: 'x86' } })
  })

  it('an x86-only mod for a 64-bit Q2PRO selects content-only', async () => {
    const target = await resolveEngineTarget(
      { engineKind: 'q2pro', executablePath: 'C:\q2\q2pro.exe', executableKind: 'pe' },
      [],
      reading('x86_64'),
    )
    const sel = selectVariant(version([{ platform: 'win32', arch: 'x86', packages: [pkg('lib32')] }]), target)
    expect(sel).toMatchObject({ contentOnly: true })
    expect('variant' in sel && sel.variant.packages[0]?.id).toBe('content')
  })

  it('the manifest arch wins over the header', async () => {
    const target = await resolveEngineTarget(
      {
        engineKind: 'q2pro',
        executablePath: 'C:\q2\q2pro.exe',
        executableKind: 'pe',
        moduleData: { downloads: { packageId: 'q2pro-nightly-win64' } },
      },
      [{ id: 'q2pro-nightly-win64', kind: 'engine', arch: 'x86_64' }],
      reading('x86'),
    )
    expect(target.arch).toBe('x86_64')
  })

  it('no variant and no content-only variant is refused', () => {
    const target: EngineTarget = { platform: 'win32', arch: 'unknown', engineKind: 'q2pro' }
    const v = version([{ platform: 'win32', arch: 'x64', packages: [pkg('lib64')] }], [])
    expect(selectVariant(v, target)).toEqual({ refused: 'mods.error.noVariant' })
  })
})
