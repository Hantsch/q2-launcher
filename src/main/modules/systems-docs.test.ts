import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG_HANDLERS } from '@shared/modules/config'
import { HOME_HANDLERS } from '@shared/modules/home'
import { LIBRARY_HANDLERS } from '@shared/modules/library'
import { MODS_HANDLERS } from '@shared/modules/mods'
import { REPLAYS_HANDLERS } from '@shared/modules/replays'
import { SERVERS_HANDLERS, SERVERS_WATCHLIST_HANDLERS } from '@shared/modules/servers'
import { sourceFiles } from '../../test-support/source-files'
import { REPO_ROOT, readRepoFile } from '../../test-support/source-tree'

/** The docs under docs/systems must describe their module as built, not an earlier plan of it. */

function readDoc(repoRelativePath: string): string {
  return readRepoFile(repoRelativePath)
}

/** The body of one `## ` section, up to the next `## ` heading; '' when the heading is absent. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n## ${heading}\n`)
  if (start === -1) return ''
  const end = doc.indexOf('\n## ', start + 1)
  return doc.slice(start, end === -1 ? undefined : end)
}

/** Every `## ` heading of a doc, in order. */
function headings(doc: string): string[] {
  return [...doc.matchAll(/^## (.+)$/gm)].map((match) => (match[1] as string).trim())
}

const FILE_EXTENSION = /\.(ts|tsx|mjs|json)$/
const ROOTED_PREFIX = /^(src|scripts|docs)\//

/** Backticked tokens that name a source file, with any `#anchor` stripped. */
function backtickedPaths(doc: string): string[] {
  const tokens = [...doc.matchAll(/`([^`\n]+)`/g)].map((match) =>
    (match[1] as string).split('#')[0]!.trim(),
  )
  return [...new Set(tokens.filter((token) => !/\s/.test(token) && FILE_EXTENSION.test(token)))]
}

let knownBasenames: Set<string> | undefined

/** Basenames of every file under src/ and scripts/, read once per run. */
function sourceBasenames(): Set<string> {
  knownBasenames ??= new Set(
    ['src', 'scripts'].flatMap((dir) =>
      sourceFiles(join(REPO_ROOT, dir)).map((file) => basename(file)),
    ),
  )
  return knownBasenames
}

/**
 * The file references in `doc` that resolve to nothing: a path rooted at src/, scripts/ or docs/
 * must exist from the repo root; any other token must at least name a file somewhere under src/
 * or scripts/.
 */
function referencedFilesMissing(doc: string): string[] {
  return backtickedPaths(doc).filter((token) =>
    ROOTED_PREFIX.test(token)
      ? !existsSync(join(REPO_ROOT, token))
      : !sourceBasenames().has(basename(token)),
  )
}

describe('config-module.md', () => {
  const doc = readDoc('docs/systems/config-module.md')

  it('names every config handler', () => {
    const handlers = section(doc, 'Handlers')
    expect(handlers, 'section "## Handlers"').not.toBe('')
    for (const key of Object.keys(CONFIG_HANDLERS)) {
      expect(handlers, key).toContain(`\`${key}\``)
    }
  })

  it('has the as-built sections', () => {
    expect(headings(doc)).toEqual([
      'Component map',
      'Flow',
      'Handlers',
      'Startup',
      'Binding decisions',
      'Known limitations',
    ])
    expect(doc).not.toMatch(/^#+ .*(Vision|Open points|interview)/im)
  })

  it('references only files that exist', () => {
    expect(backtickedPaths(doc).length).toBeGreaterThan(0)
    expect(referencedFilesMissing(doc)).toEqual([])
  })
})

const SHORT_DOC_SECTIONS = [
  'Purpose',
  'Map',
  'Persisted state',
  'Handlers',
  'External inputs',
  'Limitations',
]
const SHORT_DOC_MAX_LINES = 150

/** One row per short module doc: its file under docs/systems and every handler key it must name. */
const SHORT_DOCS: { file: string; handlerKeys: string[] }[] = [
  {
    file: 'servers-module.md',
    handlerKeys: [...Object.keys(SERVERS_HANDLERS), ...Object.keys(SERVERS_WATCHLIST_HANDLERS)],
  },
  { file: 'replays-module.md', handlerKeys: Object.keys(REPLAYS_HANDLERS) },
  { file: 'home-module.md', handlerKeys: Object.keys(HOME_HANDLERS) },
  { file: 'mods-module.md', handlerKeys: Object.keys(MODS_HANDLERS) },
]

describe('short module docs', () => {
  for (const { file, handlerKeys } of SHORT_DOCS) {
    const doc = readDoc(`docs/systems/${file}`)

    it(`${file} is at most ${SHORT_DOC_MAX_LINES} lines and has the six sections`, () => {
      expect(doc.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(SHORT_DOC_MAX_LINES)
      expect(headings(doc)).toEqual(SHORT_DOC_SECTIONS)
    })

    it(`${file} names every handler`, () => {
      const handlers = section(doc, 'Handlers')
      expect(handlers, 'section "## Handlers"').not.toBe('')
      for (const key of handlerKeys) {
        expect(handlers, key).toContain(`\`${key}\``)
      }
    })

    it(`${file} references only files that exist`, () => {
      expect(backtickedPaths(doc).length).toBeGreaterThan(0)
      expect(referencedFilesMissing(doc)).toEqual([])
    })
  }
})

/** Module folder under src/main/modules -> the doc under docs/systems that describes it. */
const MODULE_DOCS: Record<string, string> = {
  config: 'config-module.md',
  downloads: 'install-module.md',
  library: 'install-module.md',
  home: 'home-module.md',
  servers: 'servers-module.md',
  replays: 'replays-module.md',
  mods: 'mods-module.md',
}

describe('module docs coverage', () => {
  it('every registered module has a systems doc', () => {
    const modulesDir = join(REPO_ROOT, 'src/main/modules')
    const modules = readdirSync(modulesDir, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(modulesDir, entry.name, 'index.ts')),
      )
      .map((entry) => entry.name)
    expect(modules.filter((name) => !(name in MODULE_DOCS))).toEqual([])
    for (const file of new Set(Object.values(MODULE_DOCS))) {
      expect(existsSync(join(REPO_ROOT, 'docs/systems', file)), file).toBe(true)
    }
  })
})

describe('process rule', () => {
  it('Adding a module names the systems doc', () => {
    const adding = section(readDoc('docs/ARCHITECTURE.md'), 'Adding a module')
    expect(adding, 'section "## Adding a module"').not.toBe('')
    expect(adding).toContain('docs/systems/')
  })

  it('the sprint review checks the systems doc', () => {
    const scrum = readDoc('.claude/ai-scrum.md')
    const notes = scrum.slice(scrum.indexOf('\n## Notes\n'))
    expect(notes).toContain('docs/systems/')
    expect(notes).toContain('review')
    expect(section(readDoc('docs/README.md'), 'Maintenance')).toContain('systems doc')
  })
})

function statusLines(dir: string): { file: string; status: string }[] {
  return readdirSync(join(REPO_ROOT, 'docs', dir))
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({
      file,
      status: readDoc(`docs/${dir}/${file}`)
        .split('\n')
        .find((line) => line.startsWith('Status:'))
        ?.toLowerCase(),
    }))
    .filter((entry): entry is { file: string; status: string } => entry.status !== undefined)
}

describe('docs placement', () => {
  it('shipped concepts live in systems', () => {
    for (const file of ['game-browser.md', 'home-screen.md']) {
      expect(existsSync(join(REPO_ROOT, 'docs/systems', file)), file).toBe(true)
      expect(existsSync(join(REPO_ROOT, 'docs/concepts', file)), file).toBe(false)
    }
  })

  it('no systems doc says it is a draft', () => {
    for (const { file, status } of statusLines('systems')) {
      expect(status, file).not.toMatch(/draft|no stories yet|no sprint yet|planned/)
    }
  })

  it('no concept claims to be unstarted when it shipped', () => {
    for (const { file, status } of statusLines('concepts')) {
      expect(status, file).not.toMatch(/no stories yet|no sprint yet/)
    }
  })

  it('home-screen §6 names the real content repository', () => {
    const doc = readDoc('docs/systems/home-screen.md')
    expect(doc).not.toContain('only a LICENSE')
    expect(doc).toContain('engines/')
  })

  it('install-module.md names every library handler', () => {
    const doc = readDoc('docs/systems/install-module.md')
    for (const key of Object.keys(LIBRARY_HANDLERS)) {
      expect(doc, key).toContain(`\`${key}\``)
    }
  })
})
