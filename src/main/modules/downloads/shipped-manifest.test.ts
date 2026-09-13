import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'
import { parseManifestFile } from './manifest-parse'

/**
 * Story 070 D5: the two shipped manifest files
 * (`content/q2_community_content/{engines,gamedata}/manifest.json`) read
 * through D1's real parser, exactly as a caller would - no network, no
 * fixtures, just the files this repo actually ships. Covers AC6.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const ENGINES_MANIFEST_PATH = join(REPO_ROOT, 'content', 'q2_community_content', 'engines', 'manifest.json')
const GAMEDATA_MANIFEST_PATH = join(REPO_ROOT, 'content', 'q2_community_content', 'gamedata', 'manifest.json')

const SHA256_SHAPE = /^[a-f0-9]{64}$/

function fakeLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger
}

function readManifest(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('shipped manifest files parse through parseManifestFile', () => {
  it('parses engines/manifest.json as a valid (non-refused) result', () => {
    const log = fakeLogger()
    const result = parseManifestFile(readManifest(ENGINES_MANIFEST_PATH), log)
    expect(result.ok).toBe(true)
  })

  it('parses gamedata/manifest.json as a valid (non-refused) result', () => {
    const log = fakeLogger()
    const result = parseManifestFile(readManifest(GAMEDATA_MANIFEST_PATH), log)
    expect(result.ok).toBe(true)
  })

  it('carries the Q2PRO nightly package, with pinned.q2pro resolving to its id', () => {
    const log = fakeLogger()
    const result = parseManifestFile(readManifest(ENGINES_MANIFEST_PATH), log)
    if (!result.ok) throw new Error('expected ok result')

    const q2pro = result.packages.find((p) => p.id === 'q2pro-nightly-win64')
    expect(q2pro).toBeDefined()
    expect(q2pro?.kind).toBe('engine')
    expect(q2pro?.sha256).toMatch(SHA256_SHAPE)
    expect(result.pinned.q2pro).toBe('q2pro-nightly-win64')
  })

  it('carries the R1Q2 package, with pinned.r1q2 resolving to its id', () => {
    const log = fakeLogger()
    const result = parseManifestFile(readManifest(ENGINES_MANIFEST_PATH), log)
    if (!result.ok) throw new Error('expected ok result')

    const r1q2 = result.packages.find((p) => p.id === 'r1q2-b8012-msvs2022-win32')
    expect(r1q2).toBeDefined()
    expect(r1q2?.kind).toBe('engine')
    expect(r1q2?.sha256).toMatch(SHA256_SHAPE)
    expect(r1q2?.sizeBytes).toBe(751580)
    expect(result.pinned.r1q2).toBe('r1q2-b8012-msvs2022-win32')
  })

  it('carries the demo and point-release packages with their exact byte sizes and 64-hex sha256', () => {
    const log = fakeLogger()
    const result = parseManifestFile(readManifest(GAMEDATA_MANIFEST_PATH), log)
    if (!result.ok) throw new Error('expected ok result')

    const demo = result.packages.find((p) => p.id === 'q2-314-demo-x86')
    const ctf = result.packages.find((p) => p.id === 'q2-320-x86-full-ctf')

    expect(demo).toBeDefined()
    expect(demo?.kind).toBe('gamedata')
    if (demo?.kind === 'gamedata') expect(demo.role).toBe('demo')
    expect(demo?.sizeBytes).toBe(39_015_499)
    expect(demo?.sha256).toMatch(SHA256_SHAPE)

    expect(ctf).toBeDefined()
    expect(ctf?.kind).toBe('gamedata')
    if (ctf?.kind === 'gamedata') expect(ctf.role).toBe('point-release')
    expect(ctf?.sizeBytes).toBe(19_267_584)
    expect(ctf?.sha256).toMatch(SHA256_SHAPE)
  })

  it('pins both R1Q2 download locations', () => {
    const log = fakeLogger()
    const result = parseManifestFile(readManifest(ENGINES_MANIFEST_PATH), log)
    if (!result.ok) throw new Error('expected ok result')

    const r1q2 = result.packages.find((p) => p.id === 'r1q2-b8012-msvs2022-win32')
    if (!r1q2) throw new Error('expected the r1q2 package to be present')

    // Story 080 D1's own primary/fallback URLs (docs/requirements/080-*.md): the community
    // package plus the original upstream mirror, two distinct locations, never the same URL twice.
    expect(r1q2.mirrors.length).toBeGreaterThan(0)
    expect(r1q2.url).not.toBe(r1q2.mirrors[0])
  })

  it('has all four package ids present with no rows dropped', () => {
    const log = fakeLogger()
    const engines = parseManifestFile(readManifest(ENGINES_MANIFEST_PATH), log)
    const gamedata = parseManifestFile(readManifest(GAMEDATA_MANIFEST_PATH), log)
    if (!engines.ok || !gamedata.ok) throw new Error('expected ok results')

    const ids = [...engines.packages, ...gamedata.packages].map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'q2pro-nightly-win64',
        'r1q2-b8012-msvs2022-win32',
        'q2-314-demo-x86',
        'q2-320-x86-full-ctf',
      ]),
    )
    expect(log.warn).not.toHaveBeenCalled()
  })
})
