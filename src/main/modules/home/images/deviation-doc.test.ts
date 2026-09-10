import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Story 084 D7 (AC6): CLAUDE.md's Deviations table must record that feed/news slide images are a
 * second, distinct exception to the "No image assets in the UI" rule (alongside the pre-existing
 * installation-icon row from story 067) - foreign content downloaded from the news feed, not a
 * shipped/bundled asset. This reads CLAUDE.md from disk (not a copy) so the guard fails the moment
 * the row is edited away or loses any of the three properties it must have.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')
const CLAUDE_MD_PATH = resolve(REPO_ROOT, 'CLAUDE.md')

describe('CLAUDE.md records the feed-image deviation for story 084', () => {
  const contents = readFileSync(CLAUDE_MD_PATH, 'utf-8')

  // Isolate the Deviations table so a mention elsewhere in the doc cannot satisfy the assertions.
  const tableStart = contents.indexOf('## Deviations')
  expect(tableStart).toBeGreaterThan(-1)
  const deviationsSection = contents.slice(tableStart)

  const rows = deviationsSection
    .split('\n')
    .filter((line) => line.trim().startsWith('|') && !line.includes('---'))

  const feedImageRow = rows.find(
    (row) =>
      /no image assets in the ui/i.test(row) &&
      row.includes('084') &&
      /foreign/i.test(row),
  )

  it('has a Deviations row naming the "No image assets in the UI" rule', () => {
    expect(rows.some((row) => /no image assets in the ui/i.test(row))).toBe(true)
  })

  it('has a row that mentions story 084', () => {
    expect(
      rows.some(
        (row) =>
          /no image assets in the ui/i.test(row) &&
          (row.includes('084') || row.includes('084-slide-images-come-from-the-launchers-own-cache')),
      ),
    ).toBe(true)
  })

  it('has a row that gives a foreign-content reason', () => {
    expect(
      rows.some((row) => /no image assets in the ui/i.test(row) && /foreign/i.test(row)),
    ).toBe(true)
  })

  it('has exactly one row satisfying all three properties at once', () => {
    expect(feedImageRow).toBeDefined()
  })
})
