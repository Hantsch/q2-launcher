import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BulkOutcome } from '@shared/replays/bulk'
import type { Outcome } from '@shared/types/common'
import { createDemoBulkTags } from './demo-bulk-tags'
import { createSidecarStore } from './sidecar-store'

let dir: string
let archiveIds: Set<string>
let scanning: boolean
let paths: Record<string, string>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-bulk-tags-'))
  archiveIds = new Set()
  scanning = false
  paths = {}
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function demo(id: string, sidecar?: string): Promise<string> {
  const path = join(dir, `${id}.dm2`)
  await writeFile(path, 'demo-bytes')
  if (sidecar !== undefined) await writeFile(`${path}.json`, sidecar)
  paths[id] = path
  return path
}

function setup() {
  const store = createSidecarStore({
    resolveDemo: (id) =>
      paths[id] === undefined ? undefined : { kind: 'file', absolutePath: paths[id] },
  })
  const write = vi.fn(store.write)
  const service = createDemoBulkTags({
    scan: {
      isScanning: () => scanning,
      resolveFile: (id: string) =>
        paths[id] === undefined
          ? undefined
          : { absolutePath: paths[id], archiveEntry: archiveIds.has(id) ? 'a.dm2' : null },
    } as never,
    sidecars: { read: store.read, write },
  })
  return { service, write }
}

function items(outcome: Outcome<BulkOutcome>) {
  if (!outcome.ok) throw new Error('expected ok')
  return outcome.value.items
}

const sidecarTags = async (id: string): Promise<string[] | undefined> =>
  JSON.parse(await readFile(`${paths[id]}.json`, 'utf8')).tags

describe('bulk tags', () => {
  it('a demo without a sidecar gets one, a broken sidecar is never written', async () => {
    await demo('plain')
    await demo('carrier', JSON.stringify({ schemaVersion: 1, tags: ['old'] }))
    const brokenText = '{ not json'
    await demo('broken', brokenText)
    const { service, write } = setup()

    const result = items(await service.tag(['plain', 'carrier', 'broken'], ['clutch'], []))

    expect(result.map((i) => [i.demoId, i.status, i.reasonKey])).toEqual([
      ['plain', 'done', null],
      ['carrier', 'done', null],
      ['broken', 'failed', 'replays.bulk.reason.sidecarBroken'],
    ])
    expect(await sidecarTags('plain')).toEqual(['clutch'])
    expect(await sidecarTags('carrier')).toEqual(['old', 'clutch'])
    expect(await readFile(`${paths.broken}.json`, 'utf8')).toBe(brokenText)
    expect(write.mock.calls.map((c) => c[0])).toEqual(['plain', 'carrier'])
  })

  it('removes a tag only some demos carry and drops the key when none are left', async () => {
    await demo('a', JSON.stringify({ schemaVersion: 1, name: 'A', tags: ['Old'] }))
    await demo('b', JSON.stringify({ schemaVersion: 1, tags: ['keep', 'old'] }))
    await demo('c')
    const { service } = setup()

    const result = items(await service.tag(['a', 'b', 'c'], [], ['old']))

    expect(result.every((i) => i.status === 'done')).toBe(true)
    expect(await sidecarTags('a')).toBeUndefined()
    expect(JSON.parse(await readFile(`${paths.a}.json`, 'utf8')).name).toBe('A')
    expect(await sidecarTags('b')).toEqual(['keep'])
    await expect(stat(`${paths.c}.json`)).rejects.toThrow()
  })

  it('a demo that would exceed 50 tags fails with tagLimit and is left alone', async () => {
    const full = Array.from({ length: 50 }, (_, i) => `t${i}`)
    await demo('full', JSON.stringify({ schemaVersion: 1, tags: full }))
    await demo('room')
    const { service, write } = setup()

    const result = items(await service.tag(['full', 'room'], ['extra'], []))

    expect(result[0]).toMatchObject({ status: 'failed', reasonKey: 'replays.bulk.reason.tagLimit' })
    expect(result[1]?.status).toBe('done')
    expect(await sidecarTags('full')).toEqual(full)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('refuses while the scan is running', async () => {
    await demo('a')
    scanning = true
    const { service, write } = setup()

    expect(await service.tag(['a'], ['x'], [])).toEqual({
      ok: false,
      error: { key: 'replays.bulk.error.scanning' },
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('skips a demo inside a zip archive', async () => {
    await demo('zipped')
    archiveIds.add('zipped')
    const { service, write } = setup()

    const result = items(await service.tag(['zipped'], ['x'], []))

    expect(result[0]).toMatchObject({
      status: 'skipped',
      reasonKey: 'replays.bulk.reason.archiveEntry',
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('a change that alters nothing is done without writing', async () => {
    await demo('a', JSON.stringify({ schemaVersion: 1, tags: ['Clutch'] }))
    const { service, write } = setup()

    const result = items(await service.tag(['a'], ['clutch'], ['missing']))

    expect(result.map((i) => i.status)).toEqual(['done'])
    expect(write).not.toHaveBeenCalled()
    expect(await sidecarTags('a')).toEqual(['Clutch'])
  })
})
