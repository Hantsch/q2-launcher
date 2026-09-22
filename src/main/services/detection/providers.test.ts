import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stubPlatform } from '../../../test-support/platform'
import { findSteamRoot } from './providers'

/**
 * Story 100 D2: `findSteamRoot`'s non-Windows branch probes the native and Flatpak Steam roots.
 * `home` is injected at a real temp directory (mirroring `installations.test.ts`'s fixture
 * style) rather than mocking `node:fs`, and `process.platform` is stubbed via the shared
 * `stubPlatform` helper rather than assigned directly (enforced by
 * `scripts/platform-assertions.test.mjs`).
 */

let dir: string
let home: string
let restorePlatform: () => void

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-providers-'))
  home = join(dir, 'home')
  await mkdir(home, { recursive: true })
})

afterEach(async () => {
  restorePlatform?.()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('findSteamRoot on Linux', () => {
  it('finds the Steam root under the native Linux paths', async () => {
    restorePlatform = stubPlatform('linux')
    const steamRoot = join(home, '.steam', 'steam')
    await mkdir(steamRoot, { recursive: true })

    await expect(findSteamRoot(home)).resolves.toBe(steamRoot)
  })

  it('finds the Steam root under the native Linux data-dir fallback', async () => {
    restorePlatform = stubPlatform('linux')
    const steamRoot = join(home, '.local', 'share', 'Steam')
    await mkdir(steamRoot, { recursive: true })

    await expect(findSteamRoot(home)).resolves.toBe(steamRoot)
  })

  it('finds the Steam root under the Flatpak path', async () => {
    restorePlatform = stubPlatform('linux')
    const steamRoot = join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')
    await mkdir(steamRoot, { recursive: true })

    await expect(findSteamRoot(home)).resolves.toBe(steamRoot)
  })

  it('returns null when no Steam root is present', async () => {
    restorePlatform = stubPlatform('linux')

    await expect(findSteamRoot(home)).resolves.toBeNull()
  })

  it('prefers the native ~/.steam/steam root when multiple candidates exist', async () => {
    restorePlatform = stubPlatform('linux')
    const nativeRoot = join(home, '.steam', 'steam')
    const dataDirRoot = join(home, '.local', 'share', 'Steam')
    await mkdir(nativeRoot, { recursive: true })
    await mkdir(dataDirRoot, { recursive: true })

    await expect(findSteamRoot(home)).resolves.toBe(nativeRoot)
  })
})
