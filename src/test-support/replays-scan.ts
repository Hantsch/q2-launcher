import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { discoverDemos } from '../main/modules/replays/discovery'
import { ReplaysIndexCache } from '../main/modules/replays/index-cache'
import {
  createReplaysScanService,
  nameMatcherFor,
  type DemoHeaderFacts,
  type ReplaysScanFile,
  type ReplaysScanService,
} from '../main/modules/replays/scan-service'

/** One readable dm2 header's facts - what a test `parse` answers for every demo. */
export const READABLE_DEMO_FACTS: DemoHeaderFacts = {
  map: 'q2dm1',
  unparsableReason: null,
  readable: true,
  unreadable: null,
  gameDir: 'baseq2',
  pov: null,
  players: [],
  durationMs: null,
  roster: null,
}

/**
 * The real replays scan service over extra demo folders (`dirs`, one source each, in order), its
 * index cache under `root`, after its first scan has finished. `parse` defaults to
 * `READABLE_DEMO_FACTS` for every file.
 */
export async function scanExtraFolders(
  root: string,
  dirs: string[],
  parse: (file: ReplaysScanFile) => Promise<DemoHeaderFacts> = async () => READABLE_DEMO_FACTS,
): Promise<ReplaysScanService> {
  const scan = createReplaysScanService({
    emit: () => {},
    cache: new ReplaysIndexCache({ filePath: join(root, 'replays-index.json') }),
    discover: async () =>
      discoverDemos(
        [],
        dirs.map((path, i) => ({ id: `extra-${i}`, path, addedAt: '2026-01-01T00:00:00.000Z' })),
        {
          platform: process.platform,
          homeDir: root,
          zipDeps: { extractorPath: '', extractorExists: false },
        },
      ),
    parse,
    nameMatcher: () => nameMatcherFor([], 'fp-1'),
    isGameRunning: () => false,
  })
  await rescan(scan)
  return scan
}

/** Starts a scan and resolves once it has finished. */
export async function rescan(scan: ReplaysScanService): Promise<void> {
  expect(scan.start()).toEqual({ started: true })
  await vi.waitFor(() => expect(scan.isScanning()).toBe(false), { timeout: 5000 })
}

/** Whether this machine lets the test create a directory link (junction); probed once, up front, so
 * a link test is skipped visibly instead of passing without checking anything. */
export async function canLinkDirectories(): Promise<boolean> {
  const probe = await mkdtemp(join(tmpdir(), 'q2-launcher-link-probe-'))
  try {
    await mkdir(join(probe, 'target'))
    await symlink(join(probe, 'target'), join(probe, 'link'), 'junction')
    return true
  } catch {
    return false
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
}
