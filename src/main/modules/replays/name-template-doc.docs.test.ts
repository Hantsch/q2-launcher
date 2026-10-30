import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAME_TEMPLATE_TOKENS } from '../../../shared/replays/name-template'
import { SHIPPED_NAME_PATTERNS } from '../../../shared/replays/name-patterns'

/**
 * Story 139 D2: the concept doc's "## 17. Open points" item 2 (name-template syntax) must be marked
 * resolved and must actually document the token vocabulary and shipped patterns it claims to cover,
 * rather than drifting from the shipped API. This reads the doc from disk (not a copy) so the guard
 * fails the moment the section is edited away or falls out of sync with `name-template.ts` /
 * `name-patterns.ts`.
 */

const REPO_ROOT = resolve(__dirname, '../../../..')
const DOC_PATH = resolve(REPO_ROOT, 'docs/concepts/demo-browser.md')

describe('demo-browser.md documents the resolved name-template syntax', () => {
  const contents = readFileSync(DOC_PATH, 'utf-8')

  const openPointsStart = contents.indexOf('## 17. Open points')
  expect(openPointsStart).toBeGreaterThan(-1)
  const nextSectionStart = contents.indexOf('\n## ', openPointsStart + 1)
  const openPoints = contents.slice(
    openPointsStart,
    nextSectionStart === -1 ? undefined : nextSectionStart,
  )

  const item2Start = openPoints.search(/\n2\.\s+\*\*Name-template syntax\*\*/)

  it('has item 2 under Open points, about name-template syntax', () => {
    expect(item2Start).toBeGreaterThan(-1)
  })

  const item3Start = openPoints.search(/\n3\.\s+\*\*/)
  const item2 = openPoints.slice(item2Start, item3Start === -1 ? undefined : item3Start)

  it('marks item 2 as resolved', () => {
    expect(/resolved/i.test(item2)).toBe(true)
  })

  it('mentions every token from NAME_TEMPLATE_TOKENS', () => {
    for (const token of NAME_TEMPLATE_TOKENS) {
      expect(contents.includes(`{${token}}`)).toBe(true)
    }
  })

  it('mentions every shipped pattern template', () => {
    for (const pattern of SHIPPED_NAME_PATTERNS) {
      expect(contents.includes(pattern.template)).toBe(true)
    }
  })
})
