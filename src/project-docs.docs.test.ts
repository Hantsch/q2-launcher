import { describe, expect, it } from 'vitest'
import { readRepoFile } from './test-support/source-tree'
import { ALLOWED_MAIN_SPAWN_NETWORK_FILES } from './test-support/spawn-network-allowlist'

/** Project docs state the rules the source-tree tests enforce. */
describe('project docs', () => {
  it("CLAUDE.md's key rules name src/architecture.test.ts", () => {
    const text = readRepoFile('CLAUDE.md')
    const start = text.indexOf('## Key rules')
    expect(start).toBeGreaterThanOrEqual(0)
    const next = text.indexOf('\n## ', start + 1)
    const section = text.slice(start, next === -1 ? undefined : next)
    expect(section).toContain('src/architecture.test.ts')
  })

  it('CLAUDE.md carries the platform-parity rule', () => {
    expect(readRepoFile('CLAUDE.md')).toContain('Platform parity is explicit.')
  })

  it('config-module.md states the shared/config dependency direction', () => {
    const configDoc = readRepoFile('docs/systems/config-module.md')
    expect(configDoc).toContain('syntax → catalog → aliases/validation → profile → render')
    const flatPath = /src\/shared\/config\/[\w.-]+\.tsx?\b/
    for (const doc of ['docs/systems/config-module.md', 'docs/systems/profile-file-format.md']) {
      expect(readRepoFile(doc), doc).not.toMatch(flatPath)
    }
  })

  it('the build review prompt checks comments against the convention', () => {
    expect(readRepoFile('.claude/commands/build.md')).toContain(
      'comments that narrate story or review history',
    )
  })

  it('every allowlisted spawn/network file is documented in docs/ARCHITECTURE.md', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    expect(
      [...ALLOWED_MAIN_SPAWN_NETWORK_FILES].filter((path) => !doc.includes(`\`${path}\``)),
    ).toEqual([])
  })

  it('ARCHITECTURE.md states the two-tier migration rule', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    expect(doc).not.toContain('MIGRATIONS is empty')
    expect(doc).not.toContain('never touches `ipcMain`,\n   `BrowserWindow` or the state file')
    expect(doc).not.toMatch(/never touches[^.]*the state file/)
    const addingAModule = doc.slice(doc.indexOf('## Adding a module'), doc.indexOf('### Jobs'))
    expect(addingAModule).toContain('persisted.ts')
    expect(doc).toContain('Additive optional key')
    expect(doc).toContain('persisted-migrations.ts')
    expect(doc).toContain('STATE_SCHEMA_VERSION')
  })

  it('ARCHITECTURE.md states the four state kinds', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    const renderer = doc.slice(doc.indexOf('\n## Renderer'))
    const section = renderer.slice(0, renderer.indexOf('\n### Design system'))
    for (const term of [
      '### State',
      'useModuleQuery',
      'Zustand store',
      'context',
      'component state',
    ]) {
      expect(section).toContain(term)
    }
    expect(doc).not.toContain('One Zustand store')
  })

  it('ARCHITECTURE.md documents Outcome and Refusal', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    const paragraphs = doc.split(/\r?\n\s*\r?\n/)
    expect(
      paragraphs.some((p) =>
        ['Outcome<T>', 'Refusal<R>', 'refuse()', 'toastRefusal'].every((t) => p.includes(t)),
      ),
    ).toBe(true)
  })

  it('ARCHITECTURE.md names isInside as the path rule', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    const paragraph = doc
      .split(/\r?\n\r?\n/)
      .find((p) => p.includes('**Paths are never trusted.**'))
    expect(paragraph).toBeDefined()
    expect(paragraph).toContain('isInside')
  })

  it('ARCHITECTURE.md states that both surfaces turn a throw into handlerFailed', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    expect(doc).toContain('ipc.error.handlerFailed')
    expect(doc).toContain('modules.error.handlerFailed')
  })

  it('the architecture doc describes the runner', () => {
    const architecture = readRepoFile('docs/ARCHITECTURE.md')
    expect(architecture).not.toContain('No module produces jobs yet')
    expect(architecture).toContain('JobRunner.run')
    expect(architecture).toContain('installationBusy')

    const roadmap = readRepoFile('docs/ROADMAP.md')
    expect(roadmap).not.toContain('A mid-copy `PACKAGE_INCOMPLETE` failure can leave')
    expect(roadmap).not.toContain('renders that placeholder unfilled')
  })

  it('ARCHITECTURE.md states the slice-mutator rule', () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    const section = doc.split(/^## /m).find((s) => s.startsWith('State and persistence')) ?? ''

    expect(section).toContain('updateSlice')
    expect(section).toMatch(/Never read\s+->\s+spread\s+->\s+set/)
  })

  it("ARCHITECTURE.md's Adding-a-module names the module locale file", () => {
    const doc = readRepoFile('docs/ARCHITECTURE.md')
    const step = doc.slice(doc.indexOf('5. **Strings**'))
    expect(step.slice(0, 300)).toContain('modules/<id>/locale/en.json')
  })
})
