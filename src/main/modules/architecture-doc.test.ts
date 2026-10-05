import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** ARCHITECTURE.md must describe the module seam as built, not an earlier plan of it. */
const repo = resolve(__dirname, '../../..')
const doc = readFileSync(resolve(repo, 'docs/ARCHITECTURE.md'), 'utf-8')

/** The body of one `## ` section, up to the next `## ` heading. */
function section(heading: string): string {
  const start = doc.indexOf(`\n## ${heading}\n`)
  expect(start, `section "## ${heading}"`).toBeGreaterThan(-1)
  const end = doc.indexOf('\n## ', start + 1)
  return doc.slice(start, end === -1 ? undefined : end)
}

/** The `ModuleId` union members, read from the source so a new id cannot be missed. */
function moduleIds(): string[] {
  const source = readFileSync(resolve(repo, 'src/shared/types/module.ts'), 'utf-8')
  const union = /export type ModuleId\s*=([\s\S]*?)\n\s*\n/.exec(source)?.[1] ?? ''
  return [...union.matchAll(/'([a-z]+)'/g)].map((match) => match[1] as string)
}

describe('ARCHITECTURE.md', () => {
  it('Adding a module names defineModule and createModuleClient', () => {
    const adding = section('Adding a module')
    expect(adding).toContain('defineModule')
    expect(adding).toContain('createModuleClient')
    expect(doc).not.toContain("Type safety per call is the module's own job")
  })

  it('Modules as built names every ModuleId', () => {
    const ids = moduleIds()
    expect(ids).toHaveLength(8)
    const built = section('Modules as built')
    for (const id of ids) expect(built, id).toContain(`- \`${id}\` — `)
    expect(built).toContain('seven are built, `assets` is planned')
  })

  it('Adding a module lists every step', () => {
    const adding = section('Adding a module')
    for (const step of [
      'contract',
      'ModuleId',
      'persisted',
      'registry',
      'moduleClient',
      'i18n',
      'flows',
      'screens',
      'Outcome',
      'onDispose',
      'architecture.test',
      'docs/systems',
    ]) {
      expect(adding.toLowerCase(), step).toContain(step.toLowerCase())
    }
  })

  it('the sentences the review found false are gone', () => {
    for (const sentence of [
      'all four planned modules',
      'four planned modules',
      'Everything past the shell is a module: `config`, `downloads`, `mods`, `assets`',
      'No module produces jobs yet',
      '`MIGRATIONS` is empty at v1',
      'One Zustand store',
      '`library` is the working reference implementation',
    ]) {
      expect(doc, sentence).not.toContain(sentence)
    }
  })

  it('the errors, renderer-state and placement sections exist with their rules', () => {
    const errors = section('Errors and logging')
    expect(errors).toContain('Outcome')
    expect(errors).toContain('log.caught')
    expect(section('Renderer state')).toContain('query hook')
    const placement = section('Inside a renderer module')
    expect(placement).toContain('components/')
    expect(placement).toContain('lib/')
  })

  it('every planned-in-story marker points at an open story', () => {
    const done = readdirSync(resolve(repo, 'docs/requirements/done'))
    const markers = [...doc.matchAll(/\(planned in story\s+(\d{3})/g)].map((m) => m[1] as string)
    for (const story of markers) {
      expect(
        done.filter((file) => file.startsWith(`${story}-`)),
        `story ${story} is done`,
      ).toEqual([])
    }
  })

  it('the module seam has no unconverted-module remnants', () => {
    expect(doc).not.toContain('planned in story 232')
    expect(doc).not.toContain('not-yet-converted')
  })
})
