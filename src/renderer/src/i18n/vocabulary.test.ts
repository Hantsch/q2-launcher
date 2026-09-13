import { describe, expect, it } from 'vitest'
import en from './locales/en.json'

/**
 * Story 068 D2: the launcher must call the concept "engine", never "client", anywhere a user can
 * see it. `en.json` is the single source of every user-visible string (docs/ARCHITECTURE.md), so
 * walking every string value here and failing on the substring "client" is the whole guarantee -
 * no call site can reintroduce the word without this test catching it. Key *names* are not in
 * scope, only string values.
 */

const CLIENT_PATTERN = /client/i

function collectStringValues(node: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof node === 'string') {
    out.push({ path, value: node })
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      collectStringValues(child, path ? `${path}.${key}` : key, out)
    }
  }
}

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined), en)
}

describe('en.json vocabulary', () => {
  it('no user-visible string calls the engine a client', () => {
    const values: Array<{ path: string; value: string }> = []
    collectStringValues(en, '', values)

    const offenders = values.filter(({ value }) => CLIENT_PATTERN.test(value))

    expect(offenders).toEqual([])
  })

  it('the executable labels name the engine executable', () => {
    expect(stringAt('installation.engineExecutable')).toBe('Engine executable')
    expect(stringAt('library.column.engine')).toBe('Engine')
    expect(stringAt('installation.engine')).toBeUndefined()
    expect(stringAt('library.column.client')).toBeUndefined()
  })

  it('exposes a label for an unsupported engine', () => {
    expect(stringAt('engine.unsupportedLabel')).toBe('{{engine}} (unsupported)')
  })
})
