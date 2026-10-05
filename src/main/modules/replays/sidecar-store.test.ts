import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sidecarFileSchema } from '@shared/replays/sidecar'
import { createSidecarStore, type ResolvedDemo, type SidecarStoreFs } from './sidecar-store'

describe('sidecar store', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-sidecar-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  async function writeDemo(name: string): Promise<string> {
    const path = join(dir, name)
    await writeFile(path, 'demo-bytes')
    return path
  }

  function storeFor(mapping: Record<string, ResolvedDemo | undefined>) {
    return createSidecarStore({ resolveDemo: (id) => mapping[id] })
  }

  it('a first save creates the sidecar next to the demo with only the set fields', async () => {
    const finalPath = await writeDemo('final.dm2')
    const store = storeFor({ final: { kind: 'file', absolutePath: finalPath } })

    const outcome = await store.write('final', { name: 'GF #1', tags: ['clutch'] })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected ok')
    expect(outcome.value).toEqual({ status: 'saved', state: 'written' })

    const raw = await readFile(`${finalPath}.json`, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ schemaVersion: 1, name: 'GF #1', tags: ['clutch'] })

    // Separate demo ids sharing a base name but different extensions get separate sidecars.
    const dm2Path = await writeDemo('x.dm2')
    const mvd2Path = await writeDemo('x.mvd2')
    const store2 = storeFor({
      'x-dm2': { kind: 'file', absolutePath: dm2Path },
      'x-mvd2': { kind: 'file', absolutePath: mvd2Path },
    })
    await store2.write('x-dm2', { name: 'dm2 one' })
    await store2.write('x-mvd2', { name: 'mvd2 one' })

    expect(JSON.parse(await readFile(`${dm2Path}.json`, 'utf8')).name).toBe('dm2 one')
    expect(JSON.parse(await readFile(`${mvd2Path}.json`, 'utf8')).name).toBe('mvd2 one')
  })

  it("a second save replaces the sidecar's fields", async () => {
    const path = await writeDemo('final.dm2')
    const store = storeFor({ final: { kind: 'file', absolutePath: path } })

    await store.write('final', { name: 'first', description: 'a desc' })
    const outcome = await store.write('final', { name: 'second' })
    expect(outcome.ok).toBe(true)

    const raw = await readFile(`${path}.json`, 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.name).toBe('second')
    expect(parsed).not.toHaveProperty('description')

    const validated = sidecarFileSchema.parse(parsed)
    expect(Object.keys(validated).every((k) => k in sidecarFileSchema.shape)).toBe(true)
  })

  it('an identical save does not touch the file', async () => {
    const path = await writeDemo('final.dm2')
    const store = storeFor({ final: { kind: 'file', absolutePath: path } })

    await store.write('final', { name: 'same' })
    const before = (await stat(`${path}.json`)).mtimeMs

    const outcome = await store.write('final', { name: 'same' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected ok')
    expect(outcome.value).toEqual({ status: 'saved', state: 'unchanged' })

    const after = (await stat(`${path}.json`)).mtimeMs
    expect(after).toBe(before)
  })

  it('a failure during save leaves the old sidecar intact and no temp file', async () => {
    const path = await writeDemo('final.dm2')
    const sidecarPath = `${path}.json`
    let attempt = 0
    const fs: SidecarStoreFs = {
      readFile: (p) => readFile(p),
      rm: (p, opts) => rm(p, opts),
      writeAtomic: async (p, content, enc) => {
        attempt++
        await writeFile(`${p}.tmp`, content, enc)
        throw Object.assign(new Error('boom'), { code: 'EBUSY' })
      },
    }
    const store = createSidecarStore({
      resolveDemo: () => ({ kind: 'file', absolutePath: path }),
      fs,
    })

    // First save fails: no prior sidecar should exist afterward.
    const first = await store.write('final', { name: 'first' })
    expect(first.ok).toBe(false)
    await expect(readFile(sidecarPath, 'utf8')).rejects.toThrow()
    await expect(readFile(`${sidecarPath}.tmp`, 'utf8')).rejects.toThrow()

    // Seed a real sidecar via the real fs, then fail a second save on top of it.
    const realStore = createSidecarStore({
      resolveDemo: () => ({ kind: 'file', absolutePath: path }),
    })
    await realStore.write('final', { name: 'seeded' })
    const before = await readFile(sidecarPath, 'utf8')

    const second = await store.write('final', { name: 'changed' })
    expect(second.ok).toBe(false)
    expect(attempt).toBe(2)

    const after = await readFile(sidecarPath, 'utf8')
    expect(after).toBe(before)
    await expect(readFile(`${sidecarPath}.tmp`, 'utf8')).rejects.toThrow()
  })

  it('a save into a read-only location fails with a specific reason and writes nothing', async () => {
    const path = await writeDemo('final.dm2')
    const sidecarPath = `${path}.json`

    async function tryWithCode(code: string) {
      const fs: SidecarStoreFs = {
        readFile: (p) => readFile(p),
        rm: (p, opts) => rm(p, opts),
        writeAtomic: async () => {
          throw Object.assign(new Error('x'), { code })
        },
      }
      return createSidecarStore({ resolveDemo: () => ({ kind: 'file', absolutePath: path }), fs })
    }

    const beforeListing = await readdir(dir)

    const eaccesStore = await tryWithCode('EACCES')
    const eaccesOutcome = await eaccesStore.write('final', { name: 'x' })
    expect(eaccesOutcome).toEqual({
      ok: false,
      error: { key: 'replays.sidecar.error.notWritable', params: { folder: dirname(path) } },
    })

    const epermStore = await tryWithCode('EPERM')
    const epermOutcome = await epermStore.write('final', { name: 'x' })
    expect(epermOutcome).toEqual({
      ok: false,
      error: { key: 'replays.sidecar.error.notWritable', params: { folder: dirname(path) } },
    })

    const ebusyStore = await tryWithCode('EBUSY')
    const ebusyOutcome = await ebusyStore.write('final', { name: 'x' })
    expect(ebusyOutcome).toEqual({
      ok: false,
      error: { key: 'replays.sidecar.error.writeFailed', params: { code: 'EBUSY' } },
    })

    const afterListing = await readdir(dir)
    expect(afterListing.sort()).toEqual(beforeListing.sort())
    await expect(readFile(sidecarPath, 'utf8')).rejects.toThrow()
  })

  it('clearing every field deletes the sidecar', async () => {
    const path = await writeDemo('final.dm2')
    const sidecarPath = `${path}.json`
    const store = storeFor({ final: { kind: 'file', absolutePath: path } })

    await store.write('final', { name: 'to be cleared' })
    const deleteOutcome = await store.write('final', {})
    expect(deleteOutcome.ok).toBe(true)
    if (!deleteOutcome.ok) throw new Error('expected ok')
    expect(deleteOutcome.value).toEqual({ status: 'saved', state: 'deleted' })
    await expect(readFile(sidecarPath, 'utf8')).rejects.toThrow()

    const unchangedOutcome = await store.write('final', {})
    expect(unchangedOutcome.ok).toBe(true)
    if (!unchangedOutcome.ok) throw new Error('expected ok')
    expect(unchangedOutcome.value).toEqual({ status: 'saved', state: 'unchanged' })
    await expect(readFile(sidecarPath, 'utf8')).rejects.toThrow()
  })

  it('the store refuses unknown ids, archive entries, vanished demos and unreadable sidecars', async () => {
    const store = storeFor({ archived: { kind: 'archive-entry' } })

    const unknown = await store.write('nope', { name: 'x' })
    expect(unknown).toEqual({ ok: false, error: { key: 'replays.sidecar.error.unknownDemo' } })

    const archiveEntry = await store.write('archived', { name: 'x' })
    expect(archiveEntry).toEqual({
      ok: false,
      error: { key: 'replays.sidecar.error.archiveEntry' },
    })

    const vanishedPath = join(dir, 'gone.dm2')
    const vanishedStore = storeFor({ gone: { kind: 'file', absolutePath: vanishedPath } })
    const demoMissing = await vanishedStore.write('gone', { name: 'x' })
    expect(demoMissing).toEqual({ ok: false, error: { key: 'replays.sidecar.error.demoMissing' } })

    const brokenPath = await writeDemo('broken.dm2')
    await writeFile(`${brokenPath}.json`, '{ not valid json')
    const brokenBefore = await readFile(`${brokenPath}.json`, 'utf8')
    const brokenStore = storeFor({ broken: { kind: 'file', absolutePath: brokenPath } })
    const guarded = await brokenStore.write('broken', { name: 'x' })
    expect(guarded).toEqual({
      ok: true,
      value: {
        status: 'needsConfirmation',
        fileName: 'broken.dm2.json',
        issues: expect.arrayContaining([expect.objectContaining({ kind: 'invalidJson' })]),
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    })
    const brokenAfter = await readFile(`${brokenPath}.json`, 'utf8')
    expect(brokenAfter).toBe(brokenBefore)
  })

  it('read reports none, ok or error', async () => {
    const nonePath = await writeDemo('none.dm2')
    const noneStore = storeFor({ none: { kind: 'file', absolutePath: nonePath } })
    expect(await noneStore.read('none')).toEqual({
      ok: true,
      value: { state: { state: 'none' }, values: {} },
    })

    const okPath = await writeDemo('ok.dm2')
    const okStore = storeFor({ ok: { kind: 'file', absolutePath: okPath } })
    await okStore.write('ok', { name: 'valid one' })
    const okResult = await okStore.read('ok')
    expect(okResult.ok).toBe(true)
    if (!okResult.ok) throw new Error('expected ok')
    expect(okResult.value).toEqual({
      state: { state: 'ok' },
      values: { name: 'valid one' },
    })

    const invalidPath = await writeDemo('invalid.dm2')
    await writeFile(`${invalidPath}.json`, '{ broken')
    const invalidStore = storeFor({ invalid: { kind: 'file', absolutePath: invalidPath } })
    const invalidResult = await invalidStore.read('invalid')
    expect(invalidResult.ok).toBe(true)
    if (!invalidResult.ok) throw new Error('expected ok')
    expect(invalidResult.value.state.state).toBe('error')
    expect(invalidResult.value.values).toEqual({})
    if (invalidResult.value.state.state === 'error') {
      expect(invalidResult.value.state.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'invalidJson' })]),
      )
    }
  })

  it('read reports partial values alongside an error for a partially-broken sidecar', async () => {
    const path = await writeDemo('partial.dm2')
    await writeFile(
      `${path}.json`,
      JSON.stringify({ schemaVersion: 1, name: 'good name', rating: 'high' }),
    )
    const store = storeFor({ partial: { kind: 'file', absolutePath: path } })

    const result = await store.read('partial')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.state.state).toBe('error')
    if (result.value.state.state === 'error') {
      expect(result.value.state.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'invalidField',
            params: expect.objectContaining({ field: 'rating' }),
          }),
        ]),
      )
    }
    expect(result.value.values).toEqual({ name: 'good name' })
  })

  it('comments round-trip through write and read', async () => {
    const finalPath = await writeDemo('final.dm2')
    const store = storeFor({ final: { kind: 'file', absolutePath: finalPath } })
    const comments = [
      { atMs: 100, text: 'first' },
      { atMs: 5000, text: 'second' },
    ]
    const outcome = await store.write('final', { name: 'GF', comments })
    expect(outcome.ok).toBe(true)

    const read = await store.read('final')
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error('expected ok')
    expect(read.value.values).toEqual({ name: 'GF', comments })
  })
})
