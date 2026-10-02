import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from '../renderer/src/i18n/locales/en.json'
import { RESTORE_WARNING_KEYS } from '../shared/config/profile-restore'
import { DOWNLOADS_ERROR_KEYS } from '../shared/modules/downloads'
import { MODS_ERROR_KEYS } from '../shared/modules/mods'
import { APP_UPDATE_ERROR_KEYS, UPDATE_ERROR_KEYS } from './services/update/service'

/**
 * Every i18n key the main process can send across IPC must resolve to visible text in `en.json`.
 * Keys are found by scanning source for string literals; template literals and variables are out
 * of scope, so those producers are covered by exported key lists instead.
 */

const here = dirname(fileURLToPath(import.meta.url))
const sharedDir = join(here, '..', 'shared')

/** One capture group per pattern: the key literal. Append patterns here to widen the scan. */
const KEY_PATTERNS: RegExp[] = [/\bfail\(\s*(?:'([^'\n]*)'|"([^"\n]*)")/g]

function scanKeys(source: string, patterns: RegExp[]): string[] {
  const keys: string[] = []
  for (const pattern of patterns) {
    for (const m of source.matchAll(new RegExp(pattern.source, 'g'))) {
      const key = m.slice(1).find((g) => g !== undefined)
      if (key !== undefined) keys.push(key)
    }
  }
  return keys
}

function stringAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' && key in acc
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      en,
    )
}

function resolves(key: string): boolean {
  const value = stringAt(key)
  return typeof value === 'string' && value.trim() !== ''
}

function missing(keys: Iterable<string>): string[] {
  return [...new Set(keys)].filter((k) => !resolves(k))
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('main error keys', () => {
  it('every fail() literal in main resolves in en.json', () => {
    const keys = sourceFiles(here).flatMap((f) => scanKeys(readFileSync(f, 'utf8'), KEY_PATTERNS))
    expect(new Set(keys).size).toBeGreaterThanOrEqual(80)
    expect(missing(keys)).toEqual([])
  })

  it('every exported *_ERROR_KEYS member resolves', () => {
    const lists: Record<string, readonly string[]> = {
      DOWNLOADS_ERROR_KEYS,
      MODS_ERROR_KEYS,
      UPDATE_ERROR_KEYS,
      APP_UPDATE_ERROR_KEYS,
    }
    const found = new Set(
      [...sourceFiles(sharedDir), ...sourceFiles(here)].flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/export const (\w+_ERROR_KEYS)\b/g)].map((m) => m[1]),
      ),
    )
    expect([...found].sort()).toEqual(Object.keys(lists).sort())
    expect(missing(Object.values(lists).flat())).toEqual([])
  })

  it('every restore warning reason resolves', () => {
    expect(missing(Object.values(RESTORE_WARNING_KEYS))).toEqual([])
  })

  it('a misspelled key is reported', () => {
    const keys = scanKeys("fail('mods.error.dsikWrite')", KEY_PATTERNS)
    expect(missing(keys)).toEqual(['mods.error.dsikWrite'])
  })
})
