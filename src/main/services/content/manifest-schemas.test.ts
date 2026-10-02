import { describe, expect, it } from 'vitest'
import { manifestPackageSchema } from './manifest-schemas'

describe('manifestPackageSchema arch', () => {
  const engine = {
    kind: 'engine',
    engine: 'q2pro',
    id: 'q2pro-x',
    version: '1',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    url: 'https://example.com/a.zip',
    mirrors: [],
    contents: [{ from: '.', to: 'root' }],
  }

  it('an engine package accepts an optional arch and refuses an unknown one', () => {
    expect(manifestPackageSchema.safeParse(engine).success).toBe(true)
    const ok = manifestPackageSchema.safeParse({ ...engine, arch: 'x86_64' })
    expect(ok.success && 'arch' in ok.data ? ok.data.arch : undefined).toBe('x86_64')
    expect(manifestPackageSchema.safeParse({ ...engine, arch: 'x86' }).success).toBe(true)
    expect(manifestPackageSchema.safeParse({ ...engine, arch: 'arm64' }).success).toBe(false)
  })
})
