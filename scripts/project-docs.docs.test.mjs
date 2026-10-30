import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { checkDocs, checkTechDebt } from './check-docs.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOWS_DIR = join(ROOT, '.github/workflows')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

const section = (text, heading) => {
  const start = text.indexOf(`\n${heading}\n`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = text.indexOf('\n## ', start + heading.length)
  return text.slice(start, next === -1 ? undefined : next)
}

describe('the repo itself', () => {
  test("the repo's docs have no broken links and README matches package.json", () => {
    const result = checkDocs(ROOT)
    expect(result.brokenLinks).toEqual([])
    expect(result.versionMismatch).toBeNull()
  })
})

describe('tech-debt register', () => {
  const real = read('docs/TECH-DEBT.md')

  test('TECH-DEBT.md has the six columns', () => {
    const header = real.split('\n').find((l) => l.startsWith('| id'))
    expect(
      header
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean),
    ).toEqual(['id', 'since', 'area', 'sev', 'item', 'source'])
  })

  test('checkTechDebt accepts the real file', () => {
    expect(checkTechDebt(real)).toEqual([])
  })

  test('check-docs --overdue exits 0', () => {
    const run = spawnSync(process.execPath, ['scripts/check-docs.mjs', '--overdue'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
    expect(run.status).toBe(0)
  })
})

describe('ageing and escalation rule placement', () => {
  test('docs/README.md points at TECH-DEBT.md and states the ageing rule', () => {
    const projectSpecific = section(read('docs/README.md'), '## Project-specific')
    expect(projectSpecific).toContain('](TECH-DEBT.md)')
    expect(projectSpecific).toMatch(/three sprints/i)
    expect(projectSpecific).toMatch(/TECH-DEBT\.md/)
  })

  test('the ai-scrum profile notes route unfixed findings to TECH-DEBT.md and have /roadmap check report overdue rows', () => {
    const notes = section(read('.claude/ai-scrum.md'), '## Notes')
    expect(notes).toContain('docs/TECH-DEBT.md')
    expect(notes).toContain('--overdue')
    expect(notes).toMatch(/three sprints/i)
  })
})

describe('roadmap triage', () => {
  test("the roadmap's follow-up list is at most ten lines", () => {
    const body = section(read('docs/ROADMAP.md'), '## Follow-ups worth doing')
    const lines = body
      .split('\n')
      .slice(2)
      .filter((l) => l.trim() !== '')
    expect(lines.length).toBeLessThanOrEqual(10)
  })
})

describe('lane map in CLAUDE.md', () => {
  const lines = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf-8').split(/\r?\n/)
  const start = lines.findIndex((l) => /^## Test lanes/.test(l))
  const laneSection = start < 0 ? [] : lines.slice(start + 1)
  const end = laneSection.findIndex((l) => l.startsWith('## '))
  const body = end < 0 ? laneSection : laneSection.slice(0, end)
  const rows = body.filter((l) => l.startsWith('|'))
  const cells = (l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())

  test('the lane map is one table with lane, trigger, command, OS and blocking columns', () => {
    expect(lines.filter((l) => /^## Test lanes/.test(l))).toHaveLength(1)
    expect(cells(rows[0])).toEqual(['Lane', 'Trigger', 'Command', 'OS', 'Blocks'])
  })

  test('every workflow and npm script the lane map names exists', () => {
    const text = body.join('\n')
    const workflows = new Set(readdirSync(WORKFLOWS_DIR))
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).scripts
    for (const [, file] of text.matchAll(/`([^`\s]+\.yml)`/g))
      expect(workflows.has(file)).toBe(true)
    for (const [, name] of text.matchAll(/npm run ([\w:.-]+)/g))
      expect(scripts).toHaveProperty([name])
  })

  test('the linux lane runs verify:linux locally and blocks nothing, and no PR or release lane names a Linux job', () => {
    const row = (lane) => cells(rows.find((l) => cells(l)[0] === lane))
    const linux = row('linux')
    expect(linux[1]).toContain('local')
    expect(linux[2]).toContain('npm run verify:linux')
    expect(linux[4]).toMatch(/^No\b/)
    for (const lane of ['pr-unit', 'pr-ui', 'release'])
      expect(row(lane).join(' ')).not.toMatch(/ubuntu|linux-|AppImage|Linux/)
    const tail = body.filter((l) => !l.startsWith('|')).join('\n')
    for (const name of [
      'linux-journey',
      'linux-verify',
      'linux-update',
      'ui-flows',
      'build-linux',
      'linux.yml',
    ])
      expect(tail).not.toContain(name)
  })

  test('the lane map has a local docs row that runs check:docs and blocks nothing', () => {
    const docs = cells(rows.find((l) => cells(l)[0] === 'docs'))
    expect(docs[1]).toContain('local')
    expect(docs[2]).toContain('npm run check:docs')
    expect(docs[4]).toMatch(/^No\b/)
  })

  test("a lane's trigger names push only for workflows that run on push", () => {
    for (const row of rows.slice(2)) {
      const [lane, trigger] = cells(row)
      for (const [, file] of row.matchAll(/`([^`\s]+\.yml)`/g)) {
        const text = readFileSync(join(WORKFLOWS_DIR, file), 'utf-8')
        const onBlock = text.match(/^on:[ \t]*\r?\n((?:[ \t]+.*\r?\n|\r?\n)*)/m)?.[1] ?? ''
        const runsOnPush = /^ {2}push:/m.test(onBlock)
        expect(runsOnPush, `${lane}: ${file}`).toBe(/\bpush\b/.test(trigger))
      }
    }
  })

  test('the sprint end runs verify:linux before verify:release and records it as advisory', () => {
    const md = readFileSync(join(ROOT, '.claude/ai-scrum.md'), 'utf-8')
    const notesAt = md.search(/^## Notes/m)
    expect(notesAt, '## Notes section').toBeGreaterThan(-1)
    const notes = md.slice(notesAt)
    const startAt = notes.search(/^Sprint end/m)
    expect(startAt, 'Sprint end paragraph in ## Notes').toBeGreaterThan(-1)
    const items = notes
      .slice(startAt)
      .split(/\r?\n/)
      .filter((l) => /^\d+\. /.test(l))
    const linux = items.findIndex((l) => l.includes('`npm run verify:linux`'))
    const release = items.findIndex((l) => /`release-verify`|`npm run verify:release`/.test(l))
    expect(linux, 'verify:linux step').toBeGreaterThan(-1)
    expect(release, 'release-verify step').toBeGreaterThan(-1)
    expect(linux).toBeLessThan(release)
    expect(items[linux]).toContain('advisory')
    expect(items[linux]).toContain('TECH-DEBT')
  })
})

describe('ai-scrum notes', () => {
  test('the ai-scrum notes have roadmap check and sprint phase 3 run check:docs', () => {
    const notes = section(read('.claude/ai-scrum.md'), '## Notes')
    const paragraphs = notes.split(/\r?\n\s*\r?\n/).filter((p) => p.includes('npm run check:docs'))
    expect(paragraphs, 'one notes paragraph names npm run check:docs').toHaveLength(1)
    expect(paragraphs[0]).toContain('/roadmap check')
    expect(paragraphs[0]).toContain('phase 3')
  })
})

describe('release pipeline docs', () => {
  test("the repo's README announces the published release and its SmartScreen warning", () => {
    const readme = read('README.md')
    expect(readme).not.toContain('No release build is published yet')
    expect(readme).toContain('SmartScreen')
    expect(readme).toContain('github.com/Hantsch/q2-launcher/releases')
  })

  test('CLAUDE.md states that a release runs only when dispatched, after its own ci checks', () => {
    const lines = read('CLAUDE.md').split(/\r?\n/)
    const ok = (l) => /only when dispatched/.test(l) && /`ci`/.test(l) && /skip_ci_guard/.test(l)
    expect(lines.some(ok)).toBe(true)
  })

  test('changelog-path points at CHANGELOG.md', () => {
    const profile = read('.claude/ai-scrum.md')
    expect(profile).toMatch(/^changelog-path:\s*CHANGELOG\.md\s*$/m)
    expect(profile).not.toMatch(/^changelog-path:\s*none\s*$/m)
  })
})

describe('test kit docs', () => {
  test('ARCHITECTURE.md has a Testing section naming the kit, installTempDir and the 1,500-line cap', () => {
    const doc = read('docs/ARCHITECTURE.md')
    const start = doc.search(/^## Testing\s*$/m)
    expect(start).toBeGreaterThanOrEqual(0)
    const rest = doc.slice(start + 3)
    const next = rest.search(/^## /m)
    const section = next === -1 ? rest : rest.slice(0, next)
    for (const needle of ['src/test-support/', 'installTempDir', '1,500']) {
      expect(section).toContain(needle)
    }
  })
})
