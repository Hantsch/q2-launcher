import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { en } from '../renderer/src/i18n/bundle'
import { RESTORE_WARNING_KEYS } from '../shared/config/profile/profile-restore'
import { DOWNLOADS_ERROR_KEYS } from '../shared/modules/downloads'
import { MODS_ERROR_KEYS } from '../shared/modules/mods'
import { NAME_TEMPLATE_ERROR } from '../shared/replays/name-template'
import { SERVER_ADDRESS_REJECTION_KEYS } from '../shared/servers/address'
import { MASTER_SOURCES_REFUSAL_KEYS } from './modules/servers/master-sources'
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

function isText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function resolves(key: string): boolean {
  return isText(stringAt(key))
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

  describe('refusal keys', () => {
    /** Argument shapes whose values are covered elsewhere: imported maps below, or `*_REASON_KEY` definitions. */
    const COVERED_ARGUMENTS: RegExp[] = [
      /^NAME_TEMPLATE_ERROR\.\w+/,
      /^[A-Z][A-Z_]*_REASON_KEY\b/,
      /^MASTER_SOURCES_REFUSAL_KEYS\[/,
      /^NAME_PROBLEM_KEYS\[/,
      /^serverAddressRejectionKey\(/,
      /^masterSourceFailureKey\(/,
      /^reasonKey\b/,
      /^availability\.reason\.key\b/,
      /^(?:R|string)\b/,
    ]
    const DEFINITION_PATTERNS: RegExp[] = [
      /\b[A-Z][A-Z_]*_REASON_KEY\b\s*(?::[^=\n]+)?=\s*(?:'([^'\n]*)'|"([^"\n]*)")/g,
      /\breturn\s+(?:'([a-z][\w-]*(?:\.[\w-]+)+)'|"([a-z][\w-]*(?:\.[\w-]+)+)")/g,
    ]

    // Sent with a `count` param, so they resolve through `_other`, not a bare leaf.
    const PLURAL_REASON_KEYS = new Set(['runner.unavailable.protonNotDriven'])

    function missingRefusals(keys: Iterable<string>): string[] {
      return [...new Set(keys)].filter((k) =>
        PLURAL_REASON_KEYS.has(k) ? !isText(stringAt(`${k}_other`)) : !resolves(k),
      )
    }

    function stripComments(source: string): string {
      return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    }

    interface RefusalScan {
      literals: string[]
      templates: number
      unknown: string[]
    }

    function scanRefusals(raw: string): RefusalScan {
      const source = stripComments(raw)
      const importsRefuse = /import\s*\{[^}]*\brefuse\b[^}]*\}\s*from/.test(source)
      const out: RefusalScan = { literals: [], templates: 0, unknown: [] }
      const starts = importsRefuse
        ? /(?<![\w.])(?:refuse\(|reasonKey:)\s*/g
        : /(?<![\w.])reasonKey:\s*/g
      for (const m of source.matchAll(starts)) {
        const rest = source.slice(m.index + m[0].length)
        const literal = /^(?:'([^'\n]*)'|"([^"\n]*)")/.exec(rest)
        if (literal) out.literals.push(literal[1] ?? literal[2])
        else if (rest.startsWith('`')) out.templates += 1
        else if (!COVERED_ARGUMENTS.some((p) => p.test(rest))) out.unknown.push(rest.split('\n')[0])
      }
      out.literals.push(...scanKeys(source, DEFINITION_PATTERNS))
      for (const block of source.matchAll(/\bNAME_PROBLEM_KEYS\b[^=\n]*=\s*\{([^}]*)\}/g)) {
        out.literals.push(...scanKeys(block[1], [/'([^'\n]*)'/g]))
      }
      return out
    }

    const scanned = [...sourceFiles(here), ...sourceFiles(sharedDir)].map((file) => ({
      file,
      ...scanRefusals(readFileSync(file, 'utf8')),
    }))
    const scopedToModules = scanned.filter(
      (s) => s.file.startsWith(join(here, 'modules')) || s.file.startsWith(sharedDir),
    )

    it('every reasonKey and refuse() literal resolves in en.json', () => {
      const keys = [
        ...scanned.flatMap((s) => s.literals),
        ...Object.values(MASTER_SOURCES_REFUSAL_KEYS),
        ...Object.values(SERVER_ADDRESS_REJECTION_KEYS),
        ...Object.values(NAME_TEMPLATE_ERROR),
      ]
      expect(new Set(keys).size).toBeGreaterThanOrEqual(40)
      expect(missingRefusals(keys)).toEqual([])
      expect(scanned.flatMap((s) => s.unknown.map((u) => `${s.file}: ${u}`))).toEqual([])
    })

    it('no refusal key is built from a template', () => {
      expect(scopedToModules.filter((s) => s.templates > 0).map((s) => s.file)).toEqual([])
    })

    it('a misspelled reasonKey literal fails the scan', () => {
      const scan = scanRefusals("return { ok: false, reasonKey: 'mods.error.dsikWrite' }")
      expect(missingRefusals(scan.literals)).toEqual(['mods.error.dsikWrite'])
      expect(scanRefusals('x = { reasonKey: computeKey(a) }').unknown).toHaveLength(1)
      expect(scanRefusals('reasonKey: `a.${b}`').templates).toBe(1)
    })
  })
})
