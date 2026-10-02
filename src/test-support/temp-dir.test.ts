import { existsSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { useTempDir } from './temp-dir'

describe('useTempDir gives each test a fresh dir and removes it afterwards', () => {
  const dir = useTempDir('q2-launcher-temp-dir-test-')
  const seen: string[] = []

  afterAll(() => {
    expect(seen).toHaveLength(2)
    for (const path of seen) expect(existsSync(path)).toBe(false)
  })

  it('first test sees an existing dir', () => {
    expect(existsSync(dir())).toBe(true)
    seen.push(dir())
  })

  it('second test sees a different existing dir', () => {
    expect(existsSync(dir())).toBe(true)
    expect(seen).not.toContain(dir())
    seen.push(dir())
  })
})
