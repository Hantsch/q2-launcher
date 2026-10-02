import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { waitForStateJson } from './state-json.mjs'

describe('waitForStateJson', () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'state-json-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('waits until the predicate holds', async () => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ n: 1 }))
    setTimeout(() => writeFileSync(join(dir, 'state.json'), JSON.stringify({ n: 2 })), 80)
    const doc = await waitForStateJson(dir, (d) => d.n === 2, 'n to be 2', { intervalMs: 10 })
    expect(doc).toEqual({ n: 2 })
  })

  it('times out naming the label and the last doc', async () => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ n: 1 }))
    await expect(
      waitForStateJson(dir, (d) => d.n === 2, 'n to be 2', { timeoutMs: 60, intervalMs: 10 }),
    ).rejects.toThrow(/n to be 2.*"n":1/)
  })

  it('a missing file counts as not yet', async () => {
    setTimeout(() => writeFileSync(join(dir, 'state.json'), JSON.stringify({ ok: true })), 80)
    const doc = await waitForStateJson(dir, (d) => d.ok, 'file to appear', { intervalMs: 10 })
    expect(doc).toEqual({ ok: true })
  })
})
