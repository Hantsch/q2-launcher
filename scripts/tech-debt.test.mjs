import { describe, expect, test } from 'vitest'
import { checkTechDebt, overdueTechDebt } from './check-docs.mjs'

const HEADER = '| id | since | area | sev | item | source |\n| -- | -- | -- | -- | -- | -- |\n'
const LINK = '[x](reviews/x.md)'
const doc = (row, next = 'TD-005') => `Next id: ${next}\n\n${HEADER}${row}\n`
const good = `| TD-001 | S31 | config | low | an item | ${LINK} |`

describe('tech-debt register', () => {
  test('checkTechDebt accepts a well-formed row and rejects a malformed one', () => {
    expect(checkTechDebt(doc(good))).toEqual([])
    const bad = (row, next) => checkTechDebt(doc(row, next))
    expect(bad(`| TD-001 | S31 | | low | an item | ${LINK} |`)).not.toEqual([])
    expect(bad(`| TD-001 | 31 | config | low | an item | ${LINK} |`)).not.toEqual([])
    expect(bad(`| TD-001 | S31 | config | urgent | an item | ${LINK} |`)).not.toEqual([])
    expect(bad(`${good}\n${good}`)).not.toEqual([])
    expect(bad(`| TD-005 | S31 | config | low | an item | ${LINK} |`)).not.toEqual([])
    expect(bad('| TD-001 | S31 | config | low | an item | no link |')).not.toEqual([])
    expect(checkTechDebt(`${HEADER}${good}\n`)).not.toEqual([])
    expect(bad(good, 'soon')).not.toEqual([])
  })

  test('overdueTechDebt lists a row older than three sprints and not one exactly three old', () => {
    const rows = [
      { id: 'TD-001', since: 'S29' },
      { id: 'TD-002', since: 'S30' },
    ]
    expect(overdueTechDebt(rows, 33).map((r) => r.id)).toEqual(['TD-001'])
    expect(overdueTechDebt(rows, 'S33').map((r) => r.id)).toEqual(['TD-001'])
    expect(overdueTechDebt(rows, 34).map((r) => r.id)).toEqual(['TD-001', 'TD-002'])
  })
})
