import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseDemoHeader } from '@shared/demos/demo-header'
import { createDm2FrameCounter } from '@shared/demos/dm2-frames'

const DEMO_DIR = fileURLToPath(new URL('.', import.meta.url))

const demoNames = readdirSync(DEMO_DIR).filter(
  (name) => name.endsWith('.dm2') || name.endsWith('.dm2.gz'),
)

function readDemo(name: string): Buffer {
  const bytes = readFileSync(join(DEMO_DIR, name))
  return name.endsWith('.gz') ? gunzipSync(bytes) : bytes
}

describe('engine test demos', () => {
  it('the move-fire recording is present plain and gzipped', () => {
    expect(demoNames).toEqual(expect.arrayContaining(['move-fire.dm2', 'move-fire.dm2.gz']))
  })

  it.each(demoNames)('each test demo names its map and protocol: %s', (name) => {
    expect(parseDemoHeader(readDemo(name))).toMatchObject({
      ok: true,
      format: 'dm2',
      map: 'demo1',
      protocol: 34,
    })
  })

  it('the gz demo is the same recording', () => {
    const gunzipped = readDemo('move-fire.dm2.gz')
    const plain = readDemo('move-fire.dm2')
    expect(gunzipped.equals(plain)).toBe(true)
  })

  it('move-fire runs 20 to 40 seconds', () => {
    const counter = createDm2FrameCounter()
    counter.push(readDemo('move-fire.dm2'))
    const result = counter.finish()
    expect(result).toMatchObject({ ok: true, complete: true })
    if (!result.ok) return
    expect(result.durationMs).toBeGreaterThanOrEqual(20_000)
    expect(result.durationMs).toBeLessThanOrEqual(40_000)
  })
})
