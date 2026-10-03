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
  {
    from: 'src/renderer/src/modules/servers/AddToAddressBookDialog.tsx',
    to: 'src/renderer/src/modules/config/client',
    story: '175',
    reason: 'the address book is a config cvar, saved through the config client',
  },
]

/** Shrinks only: a new `as any` in production code needs a typed alternative instead. */
const AS_ANY_BASELINE = 0

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
      /^\s*export\s+\*\s+from\s+'@shared\/[^']*'\s*;?\s*$/.test(stripComments(TEXT.get(file) ?? '')),
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
})
