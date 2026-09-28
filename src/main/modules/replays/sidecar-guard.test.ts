import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SidecarSaveResult } from '@shared/modules/replays'
import type { Outcome } from '@shared/types/common'
import { createSidecarStore, sha256Hex, type SidecarStoreFs } from './sidecar-store'

// Story 147: a broken sidecar on disk is never replaced or deleted without a confirmation that
// names the exact bytes being replaced; a valid or absent one saves exactly as in story 146.
describe('sidecar replace guard', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-sidecar-guard-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  async function setup(sidecar?: string | Buffer) {
    const demoPath = join(dir, 'final.dm2')
    await writeFile(demoPath, 'demo-bytes')
    const sidecarPath = `${demoPath}.json`
    if (sidecar !== undefined) await writeFile(sidecarPath, sidecar)
    const store = createSidecarStore({ resolveDemo: (id) => (id === 'final' ? { kind: 'file', absolutePath: demoPath } : undefined) })
    return { store, sidecarPath }
  }

  async function snapshot(path: string) {
    return { bytes: await readFile(path), mtimeMs: (await stat(path)).mtimeMs }
  }

  function needsConfirmation(outcome: Outcome<SidecarSaveResult>) {
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.key}`)
    if (outcome.value.status !== 'needsConfirmation') throw new Error(`expected needsConfirmation, got ${outcome.value.status}`)
    return outcome.value
  }

  const brokenKinds = [
    { label: 'invalid JSON', content: '{ not valid json', issue: { kind: 'invalidJson' } },
    {
      label: 'an invalid field',
      content: JSON.stringify({ schemaVersion: 1, name: 'good', rating: 'high' }),
      issue: { kind: 'invalidField', params: expect.objectContaining({ field: 'rating' }) },
    },
    {
      label: 'an unknown schemaVersion',
      content: JSON.stringify({ schemaVersion: 99, name: 'future' }),
      issue: { kind: 'unknownVersion' },
    },
  ]

  for (const broken of brokenKinds) {
    it(`an unconfirmed save over a sidecar with ${broken.label} asks and touches nothing`, async () => {
      const { store, sidecarPath } = await setup(broken.content)
      const before = await snapshot(sidecarPath)

      const outcome = await store.write('final', { name: 'mine' })

      const value = needsConfirmation(outcome)
      expect(value.fileName).toBe('final.dm2.json')
      expect(value.issues).toEqual(expect.arrayContaining([expect.objectContaining(broken.issue)]))
      expect(value.fingerprint).toBe(sha256Hex(before.bytes))
      expect(await snapshot(sidecarPath)).toEqual(before)
    })
  }

  it('a confirmed save with the matching fingerprint replaces the broken sidecar', async () => {
    const { store, sidecarPath } = await setup('{ not valid json')
    const { fingerprint } = needsConfirmation(await store.write('final', { name: 'mine' }))

    const outcome = await store.write('final', { name: 'mine', tags: ['clutch'] }, fingerprint)

    expect(outcome).toEqual({ ok: true, value: { status: 'saved', state: 'written' } })
    expect(JSON.parse(await readFile(sidecarPath, 'utf8'))).toEqual({ schemaVersion: 1, name: 'mine', tags: ['clutch'] })
  })

  it('a fingerprint taken before the file changed is stale and asks again', async () => {
    const { store, sidecarPath } = await setup('{ not valid json')
    const { fingerprint: stale } = needsConfirmation(await store.write('final', { name: 'mine' }))

    // Hand-edited (or touched by a sync tool) between the prompt and the confirmed retry.
    await writeFile(sidecarPath, '{ "schemaVersion": 1, "name": 42 }')
    const before = await snapshot(sidecarPath)

    const value = needsConfirmation(await store.write('final', { name: 'mine' }, stale))

    expect(value.fingerprint).not.toBe(stale)
    expect(value.fingerprint).toBe(sha256Hex(before.bytes))
    expect(await snapshot(sidecarPath)).toEqual(before)
  })

  it('the fingerprint covers raw bytes, so an edit a UTF-8 decode would hide is still stale', async () => {
    // 0xE9 and 0xE8 are both invalid UTF-8 here and decode to the same U+FFFD.
    const { store, sidecarPath } = await setup(Buffer.from([0x7b, 0x20, 0xe9]))
    const { fingerprint: stale } = needsConfirmation(await store.write('final', { name: 'mine' }))

    await writeFile(sidecarPath, Buffer.from([0x7b, 0x20, 0xe8]))
    const before = await snapshot(sidecarPath)

    const value = needsConfirmation(await store.write('final', { name: 'mine' }, stale))
    expect(value.fingerprint).not.toBe(stale)
    expect(await snapshot(sidecarPath)).toEqual(before)
  })

  it('a sidecar broken by hand right before the save is guarded like any other', async () => {
    const { store, sidecarPath } = await setup()
    expect(await store.write('final', { name: 'valid first' })).toEqual({
      ok: true,
      value: { status: 'saved', state: 'written' },
    })
    expect((await store.read('final')).ok).toBe(true)

    await writeFile(sidecarPath, '{ "schemaVersion": 1, "name": ')
    const before = await snapshot(sidecarPath)

    const value = needsConfirmation(await store.write('final', { name: 'overwrite?' }))
    expect(value.issues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'invalidJson' })]))
    expect(value.fingerprint).toBe(sha256Hex(before.bytes))
    expect(await snapshot(sidecarPath)).toEqual(before)
  })

  it('clearing every field over a broken sidecar is guarded too, and deletes once confirmed', async () => {
    const { store, sidecarPath } = await setup(JSON.stringify({ schemaVersion: 99 }))
    const before = await snapshot(sidecarPath)

    const value = needsConfirmation(await store.write('final', {}))
    expect(value.fileName).toBe('final.dm2.json')
    expect(await snapshot(sidecarPath)).toEqual(before)

    const outcome = await store.write('final', {}, value.fingerprint)
    expect(outcome).toEqual({ ok: true, value: { status: 'saved', state: 'deleted' } })
    await expect(stat(sidecarPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('a sidecar that cannot be read at all is refused, never replaced', async () => {
    const { sidecarPath } = await setup('{ "schemaVersion": 1, "name": "hidden" }')
    const demoPath = sidecarPath.slice(0, -'.json'.length)
    const fs: SidecarStoreFs = {
      readFile: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
      rm: (p, opts) => rm(p, opts),
      writeAtomic: async () => {
        throw new Error('must not write')
      },
    }
    const store = createSidecarStore({ resolveDemo: () => ({ kind: 'file', absolutePath: demoPath }), fs })
    const before = await snapshot(sidecarPath)

    for (const confirm of [undefined, sha256Hex(''), sha256Hex(before.bytes)]) {
      expect(await store.write('final', { name: 'x' }, confirm)).toEqual({
        ok: false,
        error: { key: 'replays.sidecar.error.existingInvalid' },
      })
      expect(await store.write('final', {}, confirm)).toEqual({
        ok: false,
        error: { key: 'replays.sidecar.error.existingInvalid' },
      })
    }
    expect(await snapshot(sidecarPath)).toEqual(before)
  })

  it('a valid or absent sidecar saves and deletes without any confirmation (story 146 unchanged)', async () => {
    const { store, sidecarPath } = await setup()

    expect(await store.write('final', { name: 'first' })).toEqual({ ok: true, value: { status: 'saved', state: 'written' } })
    expect(await store.write('final', { name: 'second' })).toEqual({ ok: true, value: { status: 'saved', state: 'written' } })
    expect(JSON.parse(await readFile(sidecarPath, 'utf8')).name).toBe('second')
    expect(await store.write('final', { name: 'second' })).toEqual({ ok: true, value: { status: 'saved', state: 'unchanged' } })

    // A stray confirmation on a valid file changes nothing about the outcome either.
    expect(await store.write('final', { name: 'third' }, 'not-a-fingerprint')).toEqual({
      ok: true,
      value: { status: 'saved', state: 'written' },
    })

    expect(await store.write('final', {})).toEqual({ ok: true, value: { status: 'saved', state: 'deleted' } })
    await expect(stat(sidecarPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await store.write('final', {})).toEqual({ ok: true, value: { status: 'saved', state: 'unchanged' } })
  })
})
