import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STATE_FILE, STATE_SCHEMA_VERSION, WINDOW_STATE_FILE } from './constants'
import fixtureConstants from './fixture-constants.json'
import { DEFAULT_SETTINGS } from './types/settings'

describe('fixture constants', () => {
  it('src constants and the fixture read one source', () => {
    expect(STATE_FILE).toBe(fixtureConstants.stateFile)
    expect(WINDOW_STATE_FILE).toBe(fixtureConstants.windowStateFile)
    expect(STATE_SCHEMA_VERSION).toBe(fixtureConstants.stateSchemaVersion)
    expect(DEFAULT_SETTINGS).toEqual(fixtureConstants.defaultSettings)

    const libDir = resolve(__dirname, '../../scripts/lib')
    const files = [
      'fixture.mjs',
      ...readdirSync(resolve(libDir, 'fixture'))
        .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
        .map((f) => `fixture/${f}`),
    ]
    const sources = files.map((f) => [f, readFileSync(resolve(libDir, f), 'utf8')] as const)
    // A declaration that assigns a literal is a hand-typed copy; assigning `c.<key>` is the shared read.
    const literals = {
      STATE_FILE: /\bSTATE_FILE\s*=\s*['"`]/,
      WINDOW_STATE_FILE: /\bWINDOW_STATE_FILE\s*=\s*['"`]/,
      DEFAULT_SETTINGS: /\bDEFAULT_SETTINGS\s*=\s*\{/,
      'schema version': /\b(?:CONTROLS_SEED_SCHEMA_VERSION|STATE_SCHEMA_VERSION)\s*=\s*\d/,
    }
    for (const [file, text] of sources) {
      for (const [what, re] of Object.entries(literals)) {
        expect(text, `hand-typed ${what} in ${file}`).not.toMatch(re)
      }
    }
    const core = sources.find(([f]) => f === 'fixture/core.mjs')?.[1] ?? ''
    expect(core).toMatch(/import c from '[^']*fixture-constants\.json'/)
    expect(core).toMatch(/\bSTATE_FILE\s*=\s*c\.stateFile/)
  })
})
