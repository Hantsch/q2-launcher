import { describe, expect, it } from 'vitest'
import { readRepoFile } from '../../../test-support/source-tree'

const FACTORY_HEADER = 'export function createUpdateService'

/** The factory's body: everything after its own header up to the first line that is exactly `}`. */
function factoryBody(source: string): string {
  const start = source.indexOf(FACTORY_HEADER)
  expect(start).toBeGreaterThan(-1)
  const lines = source.slice(start + FACTORY_HEADER.length).split('\n')
  const end = lines.indexOf('}')
  expect(end).toBeGreaterThan(-1)
  return lines.slice(0, end).join('\n')
}

describe('the update service is wired from its parts, not written as one closure', () => {
  it('the update service factory has at most five inner functions', () => {
    const body = factoryBody(readRepoFile('src/main/services/update/service.ts'))
    // Every depth counts, so a closure nested inside another one is not hidden by its parent.
    const functions = body.match(/\bfunction\b/g)?.length ?? 0
    const arrows = body.match(/=>/g)?.length ?? 0
    expect(functions + arrows).toBeLessThanOrEqual(5)
  })
})
