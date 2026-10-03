import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REPO_ROOT,
  isNodeOrElectron,
  isTestFile,
  listSourceFiles,
  readRepoFile,
  resolveSpecifier,
  scanImports,
  stripComments,
} from './test-support/source-tree'

/**
 * The layer rules of docs/ARCHITECTURE.md as one test: each rule walks the real import graph of
 * the production sources and expects no offenders. Test files are exempt from every rule; an
 * existing cross-module edge is only tolerated as a named entry in `ALLOWED` (story 208).
 */

interface Edge {
  from: string
  to: string
}

interface AllowedEdge extends Edge {
  story: string
  reason: string
}

const SHELL_HOSTS = 'the shell hosts a module surface directly instead of through a module slot'
const INSTALL_DIALOG = 'offers the mods catalog install in place, through the mods client'

/** One entry per production import edge that crosses a module seam today. */
const ALLOWED: ReadonlyArray<AllowedEdge> = [
  {
    from: 'src/renderer/src/cinema/main.tsx',
    to: 'src/renderer/src/modules/replays/cinema/CinemaOverlay',
    story: '187',
    reason: 'the cinema window entry renders the replays overlay as its whole UI',
  },
  {
    from: 'src/renderer/src/components/installations/CleanupConfigCopiesDialog.tsx',
    to: 'src/renderer/src/modules/config/CleanupPanel',
    story: '058',
    reason: SHELL_HOSTS,
  },
  {
    from: 'src/renderer/src/components/shell/ActionBar.tsx',
    to: 'src/renderer/src/modules/downloads/engine/EngineUpdateAction',
    story: '092',
    reason: SHELL_HOSTS,
  },
  {
    from: 'src/renderer/src/components/shell/ActionBar.tsx',
    to: 'src/renderer/src/modules/replays/useDemoStop',
    story: '173',
    reason: SHELL_HOSTS,
  },
  {
    from: 'src/renderer/src/views/LibraryView.tsx',
    to: 'src/renderer/src/modules/library/client',
    // The edge predates the story log (initial mvp commit); recorded by the story that lists it.
    story: '208',
    reason: 'the library view lives in views/ but reads its stats through the library client',
  },
  ...(
    [
      ['home/dashboard/ConfigProfilesTile.tsx', 'config/client', '087'],
      ['home/dashboard/ConfigProfilesTile.tsx', 'config/lib/care-sync', '087'],
      ['home/dashboard/PlaytimeTile.tsx', 'library/client', '087'],
      ['home/dashboard/profile-rows.ts', 'config/lib/care-sync', '087'],
    ] as const
  ).map(([file, target, story]) => ({
    from: `src/renderer/src/modules/${file}`,
    to: `src/renderer/src/modules/${target}`,
    story,
    reason: 'a dashboard tile summarises another module through its client',
  })),
  ...(
    [
      ['replays/ReplaysView.tsx', 'mods/components/InstallDecisionDialog', '193'],
      ['replays/ReplaysView.tsx', 'mods/client', '193'],
      ['servers/ServerLocalContentSection.tsx', 'mods/components/InstallDecisionDialog', '192'],
      ['servers/ServerLocalContentSection.tsx', 'mods/client', '192'],
    ] as const
  ).map(([file, target, story]) => ({
    from: `src/renderer/src/modules/${file}`,
    to: `src/renderer/src/modules/${target}`,
    story,
    reason: INSTALL_DIALOG,
  })),
  ...(['home/dashboard/ConfigProfilesTile.tsx', 'servers/AddToAddressBookDialog.tsx'] as const).map(
    (file) => ({
      from: `src/renderer/src/modules/${file}`,
      to: 'src/renderer/src/modules/config/config-profiles-store',
      story: '218',
      reason: 'reads the shared config profile list',
    }),
  ),
  {
    from: 'src/renderer/src/modules/servers/AddToAddressBookDialog.tsx',
    to: 'src/renderer/src/modules/config/client',
    story: '175',
    reason: 'the address book is a config cvar, saved through the config client',
  },
]

/** Shrinks only: a new `as any` in production code needs a typed alternative instead. */
const AS_ANY_BASELINE = 0

/** A thinned module entry registers handlers and nothing more; growth past the cap is a smell. */
const LINE_CAPS: Record<string, number> = {
  'src/main/modules/config/index.ts': 600,
}

const SOURCES = listSourceFiles('src')
const PRODUCTION = SOURCES.filter((file) => !isTestFile(file))
const TEXT = new Map(SOURCES.map((file) => [file, readRepoFile(file)]))

function edgesOf(files: readonly string[]): Edge[] {
  return files.flatMap((from) =>
    scanImports(TEXT.get(from) ?? '').map((spec) => ({ from, to: resolveSpecifier(from, spec) })),
  )
}

const ALL_EDGES = edgesOf(SOURCES)
const PRODUCTION_EDGES = edgesOf(PRODUCTION)

const isAllowed = (edge: Edge): boolean =>
  ALLOWED.some((entry) => entry.from === edge.from && entry.to === edge.to)

const under = (path: string, dir: string): boolean => path.startsWith(`${dir}/`)

/** `<a>` for a path inside `<root>/<a>/`, else undefined (a root file belongs to no module). */
function moduleOf(path: string, root: string): string | undefined {
  return under(path, root) ? /^([^/]+)\//.exec(path.slice(root.length + 1))?.[1] : undefined
}

function offenders(predicate: (edge: Edge) => boolean): string[] {
  return PRODUCTION_EDGES.filter(predicate).map((edge) => `${edge.from} -> ${edge.to}`)
}

/** Dependency order of the `src/shared/config` folders; aliases and validation share a tier. */
const CONFIG_ROOT = 'src/shared/config'
const CONFIG_RANK: Readonly<Record<string, number>> = {
  syntax: 0,
  catalog: 1,
  aliases: 2,
  validation: 2,
  profile: 3,
  render: 4,
}

const configGroupOf = (path: string): string | undefined =>
  under(path, CONFIG_ROOT) ? path.slice(CONFIG_ROOT.length + 1).split('/')[0] : undefined

/** Edges between two ranked config groups that point at a higher rank than their source. */
function rightwardConfigEdges(edges: readonly Edge[]): string[] {
  return edges
    .filter((edge) => {
      const from = CONFIG_RANK[configGroupOf(edge.from) ?? '']
      const to = CONFIG_RANK[configGroupOf(edge.to) ?? '']
      return from !== undefined && to !== undefined && to > from
    })
    .map((edge) => `${edge.from} -> ${edge.to}`)
}

const MAIN_MODULES = 'src/main/modules'
const RENDERER_MODULES = 'src/renderer/src/modules'

const isMainShell = (path: string): boolean => under(path, 'src/main') && !under(path, MAIN_MODULES)
const isRendererShell = (path: string): boolean =>
  under(path, 'src/renderer') && !under(path, RENDERER_MODULES)

/** A tsconfig is JSONC: comments and trailing commas are stripped before parsing. */
function readTsconfig(path: string): { include?: string[]; exclude?: string[]; lib?: string[] } {
  const json = JSON.parse(stripComments(readRepoFile(path)).replace(/,(\s*[}\]])/g, '$1'))
  return { include: json.include, exclude: json.exclude, lib: json.compilerOptions?.lib }
}

/** Whether a production file reads `process.env` in code (comments do not count). */
function readsProcessEnv(file: string): boolean {
  const code = stripComments(TEXT.get(file) ?? '')
  return (
    /\bprocess\s*\??\.\s*env\b/.test(code) ||
    /\bprocess\s*(?:\?\.)?\s*\[\s*['"`]env['"`]\s*\]/.test(code) ||
    /\{[^}]*\}\s*=\s*(?:globalThis\.)?process\s*(?:[;\n)]|$)/.test(code)
  )
}

function crossModule(root: string, edge: Edge): boolean {
  const a = moduleOf(edge.from, root)
  const b = moduleOf(edge.to, root)
  return a !== undefined && b !== undefined && a !== b
}

describe('architecture', () => {
  it('the scanner finds the import graph of src', () => {
    expect(ALL_EDGES.length).toBeGreaterThan(500)
  })

  it('src/shared/config/fixtures is imported only by tests and test-only helpers', () => {
    const FIXTURES = 'src/shared/config/fixtures'
    const importers = (file: string): string[] =>
      ALL_EDGES.filter((edge) => edge.to === file.replace(/\.tsx?$/, '')).map((edge) => edge.from)
    const testOnly = (file: string): boolean =>
      isTestFile(file) || (importers(file).length > 0 && importers(file).every(isTestFile))
    expect(
      ALL_EDGES.filter(
        (edge) => under(edge.to, FIXTURES) && !under(edge.from, FIXTURES) && !testOnly(edge.from),
      ).map((edge) => `${edge.from} -> ${edge.to}`),
    ).toEqual([])
  })

  it('src/shared imports no node:, electron, main, renderer or preload module', () => {
    expect(
      offenders(
        (edge) =>
          under(edge.from, 'src/shared') &&
          (isNodeOrElectron(edge.to) ||
            ['src/main', 'src/renderer', 'src/preload'].some((dir) => under(edge.to, dir))),
      ),
    ).toEqual([])
  })

  it('shared is typechecked without DOM types', () => {
    const node = readTsconfig('tsconfig.node.json')
    expect(node.include).toContain('src/shared/**/*.ts')
    expect(node.lib?.filter((lib) => /^dom/i.test(lib))).toEqual([])
  })

  it('src/renderer imports no electron, node: or src/main', () => {
    expect(
      offenders(
        (edge) =>
          under(edge.from, 'src/renderer') &&
          (isNodeOrElectron(edge.to) || under(edge.to, 'src/main')),
      ),
    ).toEqual([])
  })

  it('a main module imports another module only through an allowlisted edge', () => {
    // `modules/types.ts` is the module contract every module implements, not a module itself.
    expect(
      offenders(
        (edge) =>
          crossModule(MAIN_MODULES, edge) &&
          edge.to !== `${MAIN_MODULES}/types` &&
          !isAllowed(edge),
      ),
    ).toEqual([])
  })

  it('a main module file never imports modules/index or modules/registry', () => {
    const roots = [`${MAIN_MODULES}/index`, `${MAIN_MODULES}/registry`]
    expect(
      offenders(
        (edge) => moduleOf(edge.from, MAIN_MODULES) !== undefined && roots.includes(edge.to),
      ),
    ).toEqual([])
  })

  it('a renderer module file never imports the modules root index', () => {
    expect(
      offenders(
        (edge) =>
          moduleOf(edge.from, RENDERER_MODULES) !== undefined &&
          edge.to === `${RENDERER_MODULES}/index`,
      ),
    ).toEqual([])
  })

  it('a main shell file imports only modules/index and modules/registry', () => {
    const entryPoints = [`${MAIN_MODULES}/index`, `${MAIN_MODULES}/registry`]
    expect(
      offenders(
        (edge) =>
          isMainShell(edge.from) &&
          under(edge.to, MAIN_MODULES) &&
          !entryPoints.includes(edge.to) &&
          !isAllowed(edge),
      ),
    ).toEqual([])
  })

  it('the shell → modules allowlist is empty', () => {
    expect(ALLOWED.filter((entry) => isMainShell(entry.from))).toEqual([])
  })

  it('a renderer shell file imports only modules root files or an allowlisted edge', () => {
    const rootFiles = [`${RENDERER_MODULES}/index`, `${RENDERER_MODULES}/moduleClient`]
    expect(
      offenders(
        (edge) =>
          isRendererShell(edge.from) &&
          under(edge.to, RENDERER_MODULES) &&
          !rootFiles.includes(edge.to) &&
          !isAllowed(edge),
      ),
    ).toEqual([])
  })

  it('no module imports modules/downloads internals', () => {
    const downloads = `${MAIN_MODULES}/downloads`
    expect(
      offenders(
        (edge) =>
          under(edge.to, downloads) &&
          moduleOf(edge.from, MAIN_MODULES) !== undefined &&
          !under(edge.from, downloads),
      ),
    ).toEqual([])
    expect(ALLOWED.filter((entry) => under(entry.to, downloads))).toEqual([])
  })

  it('a renderer module imports another module only through an allowlisted edge', () => {
    expect(offenders((edge) => crossModule(RENDERER_MODULES, edge) && !isAllowed(edge))).toEqual([])
  })

  it('every allowlist entry names an existing story', () => {
    const stories = ['docs/requirements', 'docs/requirements/done'].flatMap((dir) =>
      readdirSync(join(REPO_ROOT, dir)).filter((name) => /^\d{3}-.*\.md$/.test(name)),
    )
    const unknown = ALLOWED.filter(
      (entry) =>
        !/^\d{3}$/.test(entry.story) || !stories.some((name) => name.startsWith(`${entry.story}-`)),
    )
    expect(unknown).toEqual([])
  })

  it('every allowlist entry still matches a real import', () => {
    const stale = ALLOWED.filter(
      (entry) => !PRODUCTION_EDGES.some((edge) => edge.from === entry.from && edge.to === entry.to),
    )
    expect(stale).toEqual([])
  })

  it('as any in production source does not exceed the baseline', () => {
    const count = PRODUCTION.reduce(
      (sum, file) => sum + (stripComments(TEXT.get(file) ?? '').match(/\bas any\b/g)?.length ?? 0),
      0,
    )
    expect(count).toBeLessThanOrEqual(AS_ANY_BASELINE)
  })

  it('no production file is an export-star re-export of a shared module', () => {
    const shims = PRODUCTION.filter((file) =>
      /^\s*export\s+\*\s+from\s+'@shared\/[^']*'\s*;?\s*$/.test(
        stripComments(TEXT.get(file) ?? ''),
      ),
    )
    expect(shims).toEqual([])
  })

  it('the per-file purity checks and their tsconfig excludes are gone', () => {
    // What remains are node-only test files, not purity checks.
    expect(readTsconfig('tsconfig.web.json').exclude).toEqual([
      'src/shared/replays/demo-guard.test.ts',
      'src/shared/fixture-constants.test.ts',
      'src/shared/types/common.test.ts',
      'src/renderer/src/lib/toast.test.ts',
      'src/renderer/src/modules/config/config-structure.test.ts',
      'src/renderer/src/i18n/reason-templates.test.ts',
      'src/test-support/source-files.ts',
    ])
    expect(readTsconfig('tsconfig.node.json').include).not.toContain(
      'src/renderer/src/components/shell/shell-home-ownership.test.ts',
    )
    expect(SOURCES).not.toContain('src/renderer/src/components/shell/shell-home-ownership.test.ts')
    for (const file of [
      'src/shared/servers/address.test.ts',
      'src/shared/servers/protocol.test.ts',
    ])
      expect(TEXT.get(file), file).not.toMatch(/describe\(\s*['"]purity['"]/)
  })

  it('no module source imports electron', () => {
    const importers = PRODUCTION.filter(
      (file) =>
        under(file, MAIN_MODULES) &&
        /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)['"]electron(?:\/[\w./-]+)?['"]/.test(
          stripComments(TEXT.get(file) ?? ''),
        ),
    )
    expect(importers).toEqual([])
  })

  it('no module source reads process.env', () => {
    expect(PRODUCTION.filter((file) => under(file, MAIN_MODULES) && readsProcessEnv(file))).toEqual(
      [],
    )
  })

  it('window-shared and ipc/index read no process.env', () => {
    expect(
      ['src/main/window-shared.ts', 'src/main/ipc/index.ts'].filter((file) =>
        readsProcessEnv(file),
      ),
    ).toEqual([])
  })

  it('harness reveal and external-url recording is imported only by the os service', () => {
    const recorders = /\brecordHarness(?:RevealedPath|ExternalUrl)\b/
    const allowed = ['src/main/services/os.ts', 'src/main/lib/ui-harness.ts']
    expect(
      PRODUCTION.filter(
        (file) => !allowed.includes(file) && recorders.test(stripComments(TEXT.get(file) ?? '')),
      ),
    ).toEqual([])
  })

  it('AppContext has no getMainWindow', () => {
    const source = stripComments(readRepoFile('src/main/context.ts'))
    const start = source.indexOf('export interface AppContext {')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = source.slice(start, source.indexOf('\n}\n', start))
    expect(body).not.toContain('getMainWindow')
  })

  it('the replays and mods index tests do not mock electron', () => {
    for (const file of [
      'src/main/modules/replays/index.test.ts',
      'src/main/modules/mods/index.test.ts',
    ])
      expect(TEXT.get(file), file).not.toMatch(
        /vi\.(?:mock|doMock)\(\s*['"]electron(?:\/[\w./-]+)?['"]/,
      )
  })

  it('lint runs in ci.yml and verify:release', () => {
    expect(readRepoFile('.github/workflows/ci.yml')).toContain('npm run lint')
    expect(readRepoFile('scripts/verify-release.mjs')).toContain("['run', 'lint']")
  })

  it('oxlint restricts electron and node imports in shared and renderer', () => {
    const config = JSON.parse(
      stripComments(readRepoFile('.oxlintrc.json')).replace(/,(\s*[}\]])/g, '$1'),
    ) as { overrides: { files: string[]; rules: Record<string, unknown> }[] }
    for (const glob of ['src/shared/**', 'src/renderer/**']) {
      const override = config.overrides.find((entry) => entry.files.includes(glob))
      const rule = JSON.stringify(override?.rules['no-restricted-imports'])
      expect(rule, glob).toContain('"electron"')
      expect(rule, glob).toContain('"node:*"')
    }
  })

  it('no eslint-disable comment survives and every oxlint-disable carries a reason', () => {
    const legacy = new RegExp('eslint' + '-disable')
    const directive = new RegExp('oxlint' + '-disable[\\w-]*(.*)')
    const offenders: string[] = []
    for (const file of SOURCES) {
      if (file === 'src/architecture.test.ts') continue
      const text = TEXT.get(file) ?? ''
      if (legacy.test(text)) offenders.push(`${file}: legacy directive`)
      for (const line of text.split('\n')) {
        const match = directive.exec(line)
        if (match && !/--\s*\S/.test(match[1] ?? '')) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("CLAUDE.md's key rules name src/architecture.test.ts", () => {
    const text = readRepoFile('CLAUDE.md')
    const start = text.indexOf('## Key rules')
    expect(start).toBeGreaterThanOrEqual(0)
    const next = text.indexOf('\n## ', start + 1)
    const section = text.slice(start, next === -1 ? undefined : next)
    expect(section).toContain('src/architecture.test.ts')
  })

  it('a thinned module entry stays within its line cap', () => {
    for (const [file, cap] of Object.entries(LINE_CAPS)) {
      const lines = readRepoFile(file).split('\n').length
      expect(lines, `${file} has ${lines} lines, cap ${cap}`).toBeLessThanOrEqual(cap)
    }
  })

  it("config's index.ts imports no node:fs or electron", () => {
    const file = 'src/main/modules/config/index.ts'
    const bad = edgesOf([file])
      .map((edge) => edge.to)
      .filter((to) => isNodeOrElectron(to) && !/^(node:)?path$/.test(to))
    expect(bad).toEqual([])
  })

  it("config's profile-writes reaches the app only through its deps", () => {
    const file = 'src/main/modules/config/profile-writes.ts'
    const forbidden = new Set(['src/main/context', 'electron', 'src/main/lib/paths'])
    const bad = edgesOf([file])
      .map((edge) => edge.to)
      .filter((to) => forbidden.has(to))
    expect(bad).toEqual([])
  })

  it('profile-restore/index.ts opens with a pipeline overview of at most 40 lines', () => {
    const source = readRepoFile('src/shared/config/profile/profile-restore/index.ts')
    const overview = /^\/\*\*[\s\S]*?\*\//.exec(source)?.[0] ?? ''
    expect(overview.split(/\r?\n/).length).toBeLessThanOrEqual(40)
    for (const stage of ['parse', 'fold', 'restore', 'store', 'render', 'sync'])
      expect(overview.toLowerCase()).toContain(stage)
  })

  it('no profile-restore stage file exceeds 800 lines and no function exceeds 150', () => {
    const dir = 'src/shared/config/profile/profile-restore'
    // A text scan, not a parser: a top-level declaration runs to the next column-0 `}`, which is
    // where prettier puts the closing brace of every top-level function body.
    const declaration =
      /^(?:export\s+)?(?:(?:async\s+)?function\b|const\s+\w+\s*(?::[^=]*)?=\s*(?:async\s*)?(?:<[^>]*>)?\()/
    const offenders: string[] = []
    for (const name of readdirSync(join(REPO_ROOT, dir))) {
      if (!name.endsWith('.ts') || isTestFile(name)) continue
      const lines = readRepoFile(`${dir}/${name}`)
        .replace(/\r?\n$/, '')
        .split(/\r?\n/)
      if (lines.length > 800) offenders.push(`${name}: ${lines.length} lines`)
      let start = -1
      lines.forEach((line, index) => {
        if (declaration.test(line)) start = index
        else if (start >= 0 && line.startsWith('}')) {
          const span = index - start + 1
          if (span > 150) offenders.push(`${name}:${start + 1}: function spans ${span} lines`)
          start = -1
        }
      })
    }
    expect(offenders).toEqual([])
  })
  it('src/shared/config groups import only leftward: syntax → catalog → aliases/validation → profile → render', () => {
    // Test files and fixtures/ are exempt: they sit above every group and may import any of them.
    const prod = PRODUCTION_EDGES.filter((edge) => !under(edge.from, `${CONFIG_ROOT}/fixtures`))
    expect(rightwardConfigEdges(prod)).toEqual([])

    const loose = PRODUCTION.filter(
      (file) => under(file, CONFIG_ROOT) && !file.slice(CONFIG_ROOT.length + 1).includes('/'),
    )
    expect(loose).toEqual([])

    // The check must bite: a syntax file importing a render file is rightward.
    expect(
      rightwardConfigEdges([
        { from: `${CONFIG_ROOT}/syntax/a.ts`, to: `${CONFIG_ROOT}/render/b` },
        { from: `${CONFIG_ROOT}/aliases/a.ts`, to: `${CONFIG_ROOT}/validation/b` },
        { from: `${CONFIG_ROOT}/render/a.ts`, to: `${CONFIG_ROOT}/syntax/b` },
      ]),
    ).toEqual([`${CONFIG_ROOT}/syntax/a.ts -> ${CONFIG_ROOT}/render/b`])
  })

  it('config-module.md states the shared/config dependency direction', () => {
    const configDoc = readRepoFile('docs/systems/config-module.md')
    expect(configDoc).toContain('syntax → catalog → aliases/validation → profile → render')
    const flatPath = /src\/shared\/config\/[\w.-]+\.tsx?\b/
    for (const doc of ['docs/systems/config-module.md', 'docs/systems/profile-file-format.md']) {
      expect(readRepoFile(doc), doc).not.toMatch(flatPath)
    }
  })

  it('save debounce and status are declared once in the renderer', () => {
    const hook = 'src/renderer/src/modules/config/lib/useProfileSave.ts'
    const renderer = PRODUCTION.filter((file) => under(file, 'src/renderer'))
    const declaring = (needle: string): string[] =>
      renderer.filter((file) => TEXT.get(file)?.includes(needle))
    expect(declaring('SAVE_DEBOUNCE_MS =')).toEqual([hook])
    expect(declaring('type SaveStatus')).toEqual([hook])
    for (const surface of [
      'ControlsTab',
      'SettingsTab',
      'AliasesTab',
      'LayersPanel',
      'ProfileAssignmentsPanel',
    ]) {
      const file = `src/renderer/src/modules/config/${surface}.tsx`
      expect(TEXT.get(file), file).toMatch(/import \{[^}]*\buseProfileSave\b[^}]*\} from/)
    }
  })

  it('no file outside src/shared/list implements nextSort or compareStrings', () => {
    const implementation = /\bfunction\s+(?:nextSort|compareStrings)\b|\bconst\s+compareStrings\b/
    const offenders = SOURCES.filter((file) => !under(file, 'src/shared/list')).filter((file) =>
      implementation.test(stripComments(readRepoFile(file))),
    )
    expect(offenders).toEqual([])
  })

  it('config module tests use the shared harness', () => {
    const dir = 'src/renderer/src/modules/config/'
    const tests = SOURCES.filter((file) => file.startsWith(dir) && /\.test\.tsx?$/.test(file))
    const localFixture = /(?:function|const)\s+profileFixture/
    expect(tests.filter((file) => localFixture.test(stripComments(TEXT.get(file) ?? '')))).toEqual(
      [],
    )

    const suites = [
      ...tests.filter((file) => file.startsWith(`${dir}ControlsTab.`)),
      `${dir}SettingsTab.dnd.test.tsx`,
      `${dir}AliasesTab.test.ts`,
    ]
    expect(suites).toHaveLength(9)
    expect(
      suites.filter((file) => scanImports(TEXT.get(file) ?? '').includes('react-dom/client')),
    ).toEqual([])
  })

  it('Controls rows have one slot path', () => {
    const row = 'src/renderer/src/modules/config/components/ControlsEntryRow.tsx'
    const tab = 'src/renderer/src/modules/config/ControlsTab.tsx'
    const rowSource = stripComments(TEXT.get(row) ?? '')
    expect(rowSource.match(/<BindSlot\b/g) ?? []).toHaveLength(1)
    expect([row, tab].filter((file) => (TEXT.get(file) ?? '').includes('deriveRowState'))).toEqual(
      [],
    )
  })

  it('ControlsTab.dialogs.test does not load the tab', () => {
    const test = 'src/renderer/src/modules/config/ControlsTab.dialogs.test.ts'
    expect(scanImports(readRepoFile(test)).filter((spec) => /\/ControlsTab$/.test(spec))).toEqual(
      [],
    )
  })

  it('ControlsTab stays under its soft caps', () => {
    const source = readRepoFile('src/renderer/src/modules/config/ControlsTab.tsx')
    expect(source.split(/\r?\n/).length).toBeLessThan(800)
    expect((source.match(/useState[(<]/g) ?? []).length).toBeLessThan(12)
  })
})
