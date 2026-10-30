import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveResourcePath } from './resource-path'

describe('bundled resource path', () => {
  it('packaged and dev resolve the same resource under resourcesPath and repo resources', () => {
    const resourcesPath = join('install', 'resources')
    const repoRoot = join('work', 'repo')

    expect(
      resolveResourcePath({ isPackaged: true, resourcesPath, repoRoot }, 'geoip', 'a.mmdb'),
    ).toBe(join(resourcesPath, 'geoip', 'a.mmdb'))
    expect(
      resolveResourcePath({ isPackaged: false, resourcesPath, repoRoot }, 'geoip', 'a.mmdb'),
    ).toBe(join(repoRoot, 'resources', 'geoip', 'a.mmdb'))
  })

  it('a packaged engine resolves under resourcesPath/engine', () => {
    const resourcesPath = join('install', 'resources')
    const repoRoot = join('work', 'repo')

    expect(resolveResourcePath({ isPackaged: true, resourcesPath, repoRoot }, 'engine')).toBe(
      join(resourcesPath, 'engine'),
    )
    expect(resolveResourcePath({ isPackaged: false, resourcesPath, repoRoot }, 'engine')).toBe(
      join(repoRoot, 'resources', 'engine'),
    )
  })
})
