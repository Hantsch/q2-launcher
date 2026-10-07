import { join } from 'node:path'
import { vi } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { Installation, LaunchState } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { StateStore } from '../../services/state'
import { idleState } from './index.test-helpers'
import { configState } from './persisted'
import {
  createProfileWrites,
  profileWritesFileIo,
  type ProfileWrites,
  type ProfileWritesDeps,
} from './profile-writes'
import { ProfilesStore } from './profiles'

export interface WritesHarness {
  deps: ProfileWritesDeps
  state: StateStore
  profiles: ProfilesStore
  writes: ProfileWrites
  /** Where the canonical profile files live: `<dir>/userData`. */
  canonicalDir: string
}

export interface WritesHarnessOptions {
  installations?: Installation[]
  launchState?: LaunchState
  /** A spy to observe or fail direct writes; defaults to the real writer. */
  writeTargetFile?: ProfileWritesDeps['writeTargetFile']
  /** A spy to stub a read classification; defaults to the real `readFileState`. */
  readFileState?: ProfileWritesDeps['readFileState']
  log?: Logger
}

/** A logger whose every level is a `vi.fn()`, for asserting what the write path reported. */
export function fakeLog(): Logger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger
}

/**
 * The profile write service on a temp dir and a real, loaded `StateStore` - no module boot, no
 * `electron` mock. Seed profiles with `seedConfigProfiles(harness.state, ...)`.
 */
export async function writesHarness(
  dir: string,
  options: WritesHarnessOptions = {},
): Promise<WritesHarness> {
  const state = new StateStore(join(dir, 'state.json'), { migrations: 'none' })
  await state.load()
  const profiles = new ProfilesStore(state)
  const installations = options.installations ?? []
  const launchState = options.launchState ?? idleState()
  const canonicalDir = join(dir, 'userData')
  const deps: ProfileWritesDeps = {
    profiles,
    installations: {
      list: () => installations,
      find: (id) => installations.find((installation) => installation.id === id),
    },
    launchState: () => launchState,
    config: configState(state),
    canonicalBaseDir: () => canonicalDir,
    ...profileWritesFileIo,
    ...(options.readFileState ? { readFileState: options.readFileState } : {}),
    ...(options.writeTargetFile ? { writeTargetFile: options.writeTargetFile } : {}),
    log: options.log ?? fakeLog(),
  }
  return { deps, state, profiles, writes: createProfileWrites(deps), canonicalDir }
}

/** What every content-setter handler ends in: the store call already ran, now mark the profile unsaved. */
export function markUnsaved(h: WritesHarness, profileId = 'p1'): ConfigProfile[] {
  return h.profiles.setDirty(profileId, true)
}

/** The persisted record of a profile, as `state.json` holds it. */
export function profileRecord(h: WritesHarness, profileId = 'p1'): ConfigProfile {
  return configState(h.state)
    .profiles.get()
    .find((p) => p.id === profileId)!
}
