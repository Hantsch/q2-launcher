import { describe, expect, it } from 'vitest'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { migrateStateDocument, type MigrationStep } from './migrations'

const step = (to: number, tag: string): MigrationStep => ({
  to,
  describe: tag,
  apply: (doc) => ({ ...doc, trail: [...((doc.trail as string[] | undefined) ?? []), tag] }),
})

/** A list that reaches STATE_SCHEMA_VERSION, with one step per version above 1. */
const fullList = (): MigrationStep[] =>
  Array.from({ length: STATE_SCHEMA_VERSION - 1 }, (_, i) => step(i + 2, `to${i + 2}`))

describe('migrateStateDocument', () => {
  it("runs only steps above the file's version, in order", () => {
    const { doc, migrated } = migrateStateDocument({ schemaVersion: 3 }, fullList())
    const expected = fullList()
      .filter((s) => s.to > 3)
      .map((s) => s.describe)
    expect(doc.trail ?? []).toEqual(expected)
    expect(migrated).toBe(expected.length > 0)
    expect(doc.schemaVersion).toBe(STATE_SCHEMA_VERSION)
  })

  it('treats an unversioned document as version 0 and runs every step', () => {
    const { doc, migrated } = migrateStateDocument({}, fullList())
    expect(doc.trail).toEqual(fullList().map((s) => s.describe))
    expect(migrated).toBe(true)
  })

  it('leaves a document written by a newer launcher untouched', () => {
    const input = { schemaVersion: STATE_SCHEMA_VERSION + 1 }
    const { doc, migrated } = migrateStateDocument(input, fullList())
    expect(doc).toEqual(input)
    expect(migrated).toBe(false)
  })

  it('a step list not ending at STATE_SCHEMA_VERSION throws', () => {
    expect(() => migrateStateDocument({}, fullList().slice(0, -1))).toThrow()
    expect(() => migrateStateDocument({}, [])).toThrow()
  })

  it('a step list that is not strictly ascending throws', () => {
    const list = fullList()
    expect(() => migrateStateDocument({}, [...list, list[0]])).toThrow()
  })
})
