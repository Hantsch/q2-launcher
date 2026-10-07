import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createListenerSet } from './listeners'

describe('createListenerSet', () => {
  it('emits to a copy and isolates a throwing listener', () => {
    const log = { error: vi.fn() }
    const set = createListenerSet<number>(log, 'a test')
    const calls: string[] = []
    const unsubscribeSecond = set.add(() => {
      calls.push('first')
      unsubscribeSecond()
    })
    set.add(() => {
      calls.push('second')
      throw new Error('boom')
    })
    set.add((value) => {
      calls.push(`third:${value}`)
    })

    set.emit(1)
    expect(calls).toEqual(['first', 'second', 'third:1'])
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0][0]).toContain('a test')
    expect(set.size).toBe(2)

    set.emit(2)
    expect(calls.slice(3)).toEqual(['second', 'third:2'])

    set.clear()
    expect(set.size).toBe(0)
  })

  it('emits without an argument when T is void', () => {
    const set = createListenerSet({ error: vi.fn() }, 'a void')
    const fn = vi.fn()
    set.add(fn)
    set.emit()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('listener delivery lives in one place', () => {
  it("no main file outside listeners.ts logs 'listener threw'", () => {
    const mainDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const matches: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          if (readFileSync(path, 'utf8').includes('listener threw')) {
            matches.push(relative(mainDir, path).split(sep).join('/'))
          }
        }
      }
    }
    walk(mainDir)
    expect(matches).toEqual(['lib/listeners.ts'])
  })
})
