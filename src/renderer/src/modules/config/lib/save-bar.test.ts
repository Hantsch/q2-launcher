import { describe, expect, it } from 'vitest'
import { fail, ok } from '@shared/types'
import type {
  ConfigProfile,
  SaveProfileConflict,
  SaveProfileResult,
  SaveProfileUnreadable,
} from '@shared/modules/config'
import { isProfileDirty, resolveSaveOutcome } from './save-bar'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Test profile',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('isProfileDirty', () => {
  it('is true only when dirty is exactly true', () => {
    expect(isProfileDirty(profile({ dirty: true }))).toBe(true)
  })

  it('is false when dirty is false', () => {
    expect(isProfileDirty(profile({ dirty: false }))).toBe(false)
  })

  it('is false when dirty is absent (a profile predating story 043)', () => {
    expect(isProfileDirty(profile())).toBe(false)
  })
})

describe('resolveSaveOutcome', () => {
  it('resolves a saved result to the fresh profile, ready for onSaved', () => {
    const savedProfile = profile({ dirty: false })
    const result: SaveProfileResult = {
      status: 'saved',
      profile: savedProfile,
      sync: {
        own: { path: 'c:/x/p1.cfg', fileName: 'p1.cfg', status: 'inSync' },
        installations: [],
      },
    }

    const action = resolveSaveOutcome(ok(result))

    expect(action).toEqual({ type: 'saved', profile: savedProfile })
  })

  it('resolves a conflict to its own action carrying the whole-file payload, never onSaved (story 043 D8)', () => {
    const conflict: SaveProfileConflict = {
      status: 'conflict',
      fileName: 'p1.cfg',
      path: 'c:/x/p1.cfg',
      diskContent: 'disk version',
      ourContent: 'our version',
    }

    const action = resolveSaveOutcome(ok(conflict))

    expect(action).toEqual({ type: 'conflict', conflict })
  })

  it('resolves an unparseable file to the unparseable-specific toast, carrying the message', () => {
    const unreadable: SaveProfileUnreadable = {
      status: 'unreadable',
      fileName: 'p1.cfg',
      path: 'c:/x/p1.cfg',
      reason: 'unparseable',
      line: 12,
      message: 'unexpected token',
    }

    const action = resolveSaveOutcome(ok(unreadable))

    expect(action).toEqual({
      type: 'toast',
      messageKey: 'config.save.unreadableUnparseable',
      params: { message: 'unexpected token' },
    })
  })

  it('resolves a read error to the read-error-specific toast, carrying the message', () => {
    const unreadable: SaveProfileUnreadable = {
      status: 'unreadable',
      fileName: 'p1.cfg',
      path: 'c:/x/p1.cfg',
      reason: 'readError',
      message: 'EACCES',
    }

    const action = resolveSaveOutcome(ok(unreadable))

    expect(action).toEqual({
      type: 'toast',
      messageKey: 'config.save.unreadableReadError',
      params: { message: 'EACCES' },
    })
  })

  it('resolves a transport-level failure to a toast carrying the error key and params', () => {
    const action = resolveSaveOutcome(fail('config.error.profileNotFound'))

    expect(action).toEqual({ type: 'toast', messageKey: 'config.error.profileNotFound' })
  })

  it('carries transport-level error params through when present', () => {
    const action = resolveSaveOutcome(fail('config.error.installationRunning', { name: 'baseq2' }))

    expect(action).toEqual({
      type: 'toast',
      messageKey: 'config.error.installationRunning',
      params: { name: 'baseq2' },
    })
  })
})
