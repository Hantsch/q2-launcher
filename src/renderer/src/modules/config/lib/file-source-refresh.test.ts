import { describe, expect, it } from 'vitest'
import type { ConfigProfile, RefreshedProfileResult } from '@shared/modules/config'
import { applyRefreshedProfile, didFocusResume, noticeForRefreshedProfile } from './file-source-refresh'

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

describe('didFocusResume', () => {
  it('is true on a false -> true transition', () => {
    expect(didFocusResume(false, true)).toBe(true)
  })

  it('is false while already focused (no re-trigger on every render)', () => {
    expect(didFocusResume(true, true)).toBe(false)
  })

  it('is false on a true -> false transition (losing focus)', () => {
    expect(didFocusResume(true, false)).toBe(false)
  })

  it('is false while staying unfocused', () => {
    expect(didFocusResume(false, false)).toBe(false)
  })
})

describe('applyRefreshedProfile', () => {
  it('leaves the list untouched for an unchanged result', () => {
    const list = [profile()]
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' }

    expect(applyRefreshedProfile(list, result)).toBe(list)
  })

  it('leaves the list untouched for a conflict result - main adopted nothing', () => {
    const list = [profile({ dirty: true })]
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'conflict',
      fileState: 'changedOnDisk',
      conflict: {
        status: 'conflict',
        fileName: 'p1.cfg',
        path: 'c:/x/p1.cfg',
        diskContent: 'disk',
        ourContent: 'ours',
      },
    }

    expect(applyRefreshedProfile(list, result)).toBe(list)
  })

  it('replaces the matching profile wholesale on adopted', () => {
    const stale = profile({ cvars: { sensitivity: '3' } })
    const adopted = profile({ cvars: { sensitivity: '5' }, name: 'Hand-Edited', fileState: 'unchanged' })
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'adopted',
      fileState: 'changedOnDisk',
      profile: adopted,
    }

    const next = applyRefreshedProfile([stale], result)

    expect(next).toEqual([adopted])
  })

  it('patches only fileState on missing, leaving cached content untouched', () => {
    const cached = profile({ cvars: { sensitivity: '3' } })
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'missing', fileState: 'missing' }

    const next = applyRefreshedProfile([cached], result)

    expect(next).toEqual([{ ...cached, fileState: 'missing' }])
  })

  it('patches only fileState on unparseable, leaving cached content untouched', () => {
    const cached = profile({ cvars: { sensitivity: '3' } })
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'unparseable',
      fileState: 'unparseable',
      file: 'Profile.cfg',
      line: 12,
      message: 'unexpected token',
    }

    const next = applyRefreshedProfile([cached], result)

    expect(next).toEqual([{ ...cached, fileState: 'unparseable' }])
  })

  it('patches only fileState on readError, leaving cached content untouched', () => {
    const cached = profile({ cvars: { sensitivity: '3' } })
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'readError',
      fileState: 'readError',
      message: 'EACCES',
    }

    const next = applyRefreshedProfile([cached], result)

    expect(next).toEqual([{ ...cached, fileState: 'readError' }])
  })

  it('leaves other profiles in the list untouched', () => {
    const other = profile({ id: 'p2', name: 'Other' })
    const cached = profile({ id: 'p1' })
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'missing', fileState: 'missing' }

    const next = applyRefreshedProfile([other, cached], result)

    expect(next[0]).toBe(other)
  })
})

describe('noticeForRefreshedProfile', () => {
  it('reports a reloaded notice for adopted - never a silent swap', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'adopted',
      fileState: 'changedOnDisk',
      profile: profile(),
    }

    expect(noticeForRefreshedProfile(result)).toEqual({ kind: 'reloaded' })
  })

  it('reports a conflict notice for conflict', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'conflict',
      fileState: 'changedOnDisk',
      conflict: {
        status: 'conflict',
        fileName: 'p1.cfg',
        path: 'c:/x/p1.cfg',
        diskContent: 'disk',
        ourContent: 'ours',
      },
    }

    expect(noticeForRefreshedProfile(result)).toEqual({ kind: 'conflict' })
  })

  it('carries file/line/message through for an unparseable diagnostic', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'unparseable',
      fileState: 'unparseable',
      file: 'Profile.cfg',
      line: 12,
      message: 'unexpected token',
    }

    expect(noticeForRefreshedProfile(result)).toEqual({
      kind: 'diagnostic',
      file: 'Profile.cfg',
      line: 12,
      message: 'unexpected token',
    })
  })

  it('carries only message through for a readError diagnostic - it has no position', () => {
    const result: RefreshedProfileResult = {
      profileId: 'p1',
      outcome: 'readError',
      fileState: 'readError',
      message: 'EACCES',
    }

    expect(noticeForRefreshedProfile(result)).toEqual({ kind: 'diagnostic', message: 'EACCES' })
  })

  it('has nothing to surface for unchanged', () => {
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'unchanged', fileState: 'unchanged' }

    expect(noticeForRefreshedProfile(result)).toBeNull()
  })

  it('has nothing to surface for missing - the banner reads fileState directly', () => {
    const result: RefreshedProfileResult = { profileId: 'p1', outcome: 'missing', fileState: 'missing' }

    expect(noticeForRefreshedProfile(result)).toBeNull()
  })
})
