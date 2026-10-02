import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateStore } from '../state'
import { MAX_UNLOCK_CODES, parseUnlockState, unlockState } from './persisted'

describe('parseUnlockState', () => {
  it('missing or garbled input degrades to no codes', () => {
    expect(parseUnlockState(undefined)).toEqual({ codes: [] })
    expect(parseUnlockState('nope')).toEqual({ codes: [] })
    expect(parseUnlockState({ codes: 'nope' })).toEqual({ codes: [] })
  })

  it('drops malformed rows and keeps the first of a repeated code', () => {
    const parsed = parseUnlockState({
      codes: [
        { code: 'a', redeemedAt: '2026-01-01T00:00:00.000Z' },
        { code: '', redeemedAt: '2026-01-01T00:00:00.000Z' },
        { code: 'b' },
        { code: 'a', redeemedAt: '2026-02-01T00:00:00.000Z' },
      ],
    })
    expect(parsed.codes).toEqual([{ code: 'a', redeemedAt: '2026-01-01T00:00:00.000Z' }])
  })

  it('caps the stored codes at MAX_UNLOCK_CODES after dedupe', () => {
    const codes = Array.from({ length: MAX_UNLOCK_CODES + 5 }, (_, i) => ({
      code: `c${i}`,
      redeemedAt: '2026-01-01T00:00:00.000Z',
    }))
    expect(parseUnlockState({ codes }).codes).toHaveLength(MAX_UNLOCK_CODES)
  })
})

describe('unlockState', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-unlock-section-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('starts with no codes', () => {
    expect(unlockState(state).get()).toEqual({ codes: [] })
  })

  it('redeemed codes round-trip through state.json', async () => {
    const written = unlockState(state).update(() => ({
      codes: [{ code: 'a', redeemedAt: '2026-01-01T00:00:00.000Z' }],
    }))
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(unlockState(reloaded).get()).toEqual(written)
  })

  it('a malformed row read from disk is gone after reload', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        unlock: { codes: [{ code: 'a', redeemedAt: '2026-01-01T00:00:00.000Z' }, { code: 'b' }] },
      }),
      'utf-8',
    )
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(
      unlockState(reloaded)
        .get()
        .codes.map((entry) => entry.code),
    ).toEqual(['a'])
  })
})
