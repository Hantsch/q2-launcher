import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { checkDocs, checkTechDebt, overdueTechDebt, parseTechDebt } from './check-docs.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const real = readFileSync(join(ROOT, 'docs/TECH-DEBT.md'), 'utf-8')

const HEADER = '| id | since | area | sev | item | source |\n| -- | -- | -- | -- | -- | -- |\n'
const LINK = '[x](reviews/x.md)'
const doc = (row, next = 'TD-005') => `Next id: ${next}\n\n${HEADER}${row}\n`
const good = `| TD-001 | S31 | config | low | an item | ${LINK} |`

describe('tech-debt register', () => {
  test('TECH-DEBT.md has the six columns and the review not-storied findings as its first rows', () => {
    const header = real.split('\n').find((l) => l.startsWith('| id'))
    expect(
      header
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean),
    ).toEqual(['id', 'since', 'area', 'sev', 'item', 'source'])
    const { rows } = parseTechDebt(real)
    const findings = rows.slice(0, 6).map((r) => /review (F\d+)/.exec(r.source)?.[1])
    expect(findings).toEqual(['F34', 'F49', 'F63', 'F67', 'F69', 'F75'])
  })

  test('checkTechDebt accepts the real file and rejects a malformed row', () => {
    expect(checkTechDebt(real)).toEqual([])
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

  test('check-docs --overdue exits 0', () => {
    const run = spawnSync(process.execPath, ['scripts/check-docs.mjs', '--overdue'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
    expect(run.status).toBe(0)
  })
})

const section = (text, heading) => {
  const start = text.indexOf(`\n${heading}\n`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = text.indexOf('\n## ', start + heading.length)
  return text.slice(start, next === -1 ? undefined : next)
}

describe('ageing and escalation rule placement', () => {
  test('docs/README.md points at TECH-DEBT.md and states the ageing rule', () => {
    const projectSpecific = section(
      readFileSync(join(ROOT, 'docs/README.md'), 'utf-8'),
      '## Project-specific',
    )
    expect(projectSpecific).toContain('](TECH-DEBT.md)')
    expect(projectSpecific).toMatch(/three sprints/i)
    expect(projectSpecific).toMatch(/TECH-DEBT\.md/)
  })

  test('the ai-scrum profile notes route unfixed findings to TECH-DEBT.md and have /roadmap check report overdue rows', () => {
    const notes = section(readFileSync(join(ROOT, '.claude/ai-scrum.md'), 'utf-8'), '## Notes')
    expect(notes).toContain('docs/TECH-DEBT.md')
    expect(notes).toContain('--overdue')
    expect(notes).toMatch(/three sprints/i)
  })
})

describe('roadmap triage', () => {
  const roadmap = readFileSync(join(ROOT, 'docs/ROADMAP.md'), 'utf-8')

  test("the roadmap's follow-up list is at most ten lines and links no story 199–231", () => {
    const body = section(roadmap, '## Follow-ups worth doing')
    const lines = body
      .split('\n')
      .slice(2)
      .filter((l) => l.trim() !== '')
    expect(lines.length).toBeLessThanOrEqual(10)
    for (const m of body.matchAll(/\]\(requirements\/(?:done\/)?(\d+)-/g)) {
      const n = Number(m[1])
      expect(n < 199 || n > 231).toBe(true)
    }
  })

  test('Open / unprioritised lists the codebase review with its story range and sprint cut', () => {
    const body = section(roadmap, '## Open / unprioritised')
    const row = body.split('\n').find((l) => l.includes('](reviews/2026-10-01-codebase-review.md)'))
    expect(row).toBeDefined()
    expect(row).toContain('199–231')
    expect(row).toContain('S32')
    expect(row).toContain('S33')
  })

  test('check-docs finds no broken link in ROADMAP.md or TECH-DEBT.md', () => {
    const files = ['docs/ROADMAP.md', 'docs/TECH-DEBT.md']
    expect(checkDocs(ROOT).brokenLinks.filter((b) => files.includes(b.file))).toEqual([])
  })
})
