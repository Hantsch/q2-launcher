import { describe, expect, test } from 'vitest'
import {
  MAX_FLOWS_PER_AREA,
  areaFlows,
  declaredTestIds,
  flowTestIds,
  helperClosure,
  matchesGlob,
  selectAffected,
  sharedTestIds,
  testIdOwners,
  validateAreas,
} from './lib/flow-select.mjs'
import { loadFlowTree } from './lib/flow-tree.mjs'

const tree = loadFlowTree()
const flowNames = tree.flows.map((flow) => flow.name)
const flowNamed = (name) => tree.flows.find((flow) => flow.name === name)
const select = (...changedFiles) =>
  selectAffected({
    changedFiles,
    flows: tree.flows,
    rendererFiles: tree.rendererFiles,
    areas: tree.areas,
  })
const selected = (...changedFiles) => select(...changedFiles).map((pick) => pick.flow)
const unless = (problems) => problems.join('\n')

describe('flow selection on the real tree', () => {
  test('a change to bootEnv selects bootstrap-wizard', () => {
    for (const file of ['src/main/lib/boot-env.ts', 'src/main/context.ts']) {
      const pick = select(file).find((p) => p.flow === 'bootstrap-wizard')
      expect(pick?.reasons, file).toContain(`${file} is in area "boot"`)
    }
  })

  test("a change to the component that owns a flow's testid selects that flow", () => {
    const testId = 'replays-mod-warning-enabled'
    const flow = flowNamed('quit-persists-state')
    expect([...flow.testIds.exact, ...flow.testIds.mentions]).toContain(testId)
    const owners = [...(testIdOwners(tree.rendererFiles).exact.get(testId) ?? [])]
    expect(owners.length).toBeGreaterThan(0)
    for (const owner of owners) {
      const pick = select(owner).find((p) => p.flow === 'quit-persists-state')
      expect(pick?.reasons).toContain(`${owner} declares testid "${testId}"`)
    }
  })

  test('every non-test src file is reached by a testid or an area row', () => {
    const unreached = tree.srcFiles.filter((path) => selected(path).length === 0)
    expect(unreached, 'add these to a row in scripts/flows/areas.json').toEqual([])
  })

  test('every area row names existing flows and selects at most 12', () => {
    expect(MAX_FLOWS_PER_AREA).toBe(12)
    expect(unless(validateAreas(tree.areas, flowNames))).toBe('')
    for (const row of tree.areas) {
      const count = areaFlows(row, flowNames).length
      expect(count, row.area).toBeGreaterThan(0)
      expect(count, row.area).toBeLessThanOrEqual(MAX_FLOWS_PER_AREA)
    }
  })

  test('every flow is selectable by some file', () => {
    const selectable = new Set(tree.srcFiles.flatMap((path) => selected(path)))
    expect(flowNames.filter((name) => !selectable.has(name))).toEqual([])
  })

  test('every flow that uses testids derives a non-empty set that resolves to renderer files', () => {
    const owned = tree.rendererFiles.map(({ source }) => declaredTestIds(source))
    const blind = []
    for (const flow of tree.flows) {
      const sources = [flow.path, ...flow.helpers].map((path) => tree.scripts.get(path))
      if (!sources.some((source) => /getByTestId|data-testid/.test(source))) continue
      const { exact, prefixes } = flow.testIds
      const resolves = owned.some((ids) => sharedTestIds(flow.testIds, ids).length > 0)
      if (exact.size + prefixes.size === 0 || !resolves) blind.push(flow.name)
    }
    expect(blind).toEqual([])
    expect(tree.flows.filter((flow) => flow.testIds.exact.size > 0).length).toBeGreaterThan(100)
  })

  test("a flow's helpers contribute their testids, through multi-line and transitive imports", () => {
    for (const known of ['scripts/lib/mods-install-flow.mjs', 'scripts/lib/servers-lan-flow.mjs']) {
      expect(flowTestIds(tree.scripts.get(known)).exact.size, known).toBeGreaterThan(0)
      expect(
        tree.flows.filter((flow) => flow.helpers.includes(known)).length,
        known,
      ).toBeGreaterThan(0)
    }
    let helperOnly = 0
    for (const flow of tree.flows) {
      const own = flowTestIds(tree.scripts.get(flow.path)).exact
      for (const helper of flow.helpers) {
        for (const id of flowTestIds(tree.scripts.get(helper)).exact) {
          expect(flow.testIds.exact, `${flow.name} via ${helper}`).toContain(id)
          if (!own.has(id)) helperOnly += 1
        }
      }
    }
    expect(helperOnly).toBeGreaterThan(0)
  })
})

describe('flow selection rules', () => {
  const flow = (name, source, helpers = []) => ({ name, helpers, testIds: flowTestIds(source) })

  test('globs: ** spans directories, * stays inside one segment', () => {
    expect(matchesGlob('src/main/a/b/c.ts', 'src/main/**')).toBe(true)
    expect(matchesGlob('src/main/c.ts', 'src/main/**/c.ts')).toBe(true)
    expect(matchesGlob('src/main/a/c.ts', 'src/main/*.ts')).toBe(false)
    expect(matchesGlob('src\\main\\c.ts', 'src/main/*.ts')).toBe(true)
    expect(matchesGlob('servers-lan-mode', 'servers-*')).toBe(true)
    expect(matchesGlob('src/main/a.tsx', 'src/main/a.ts')).toBe(false)
  })

  test('selector testids are exact, ^= and template literals are prefixes, bare literals are mentions', () => {
    const ids = flowTestIds(
      [
        "await page.getByTestId('nav-config').click()",
        'page.locator(\'[data-testid="config-tab-raw"]\')',
        'page.locator(\'[data-testid^="servers-row-"]\')',
        'page.getByTestId(`replays-sort-${column}`)',
        'page.locator(`[data-testid="${testId}"]`)',
        "// don't count 'commented-out-id' or apostrophes",
        "await clickTab(page, 'config-tab-aliases')",
      ].join('\n'),
      ["export const open = (page) => page.getByTestId('helper-owned-id')"],
    )
    expect([...ids.exact].sort()).toEqual(['config-tab-raw', 'helper-owned-id', 'nav-config'])
    expect([...ids.prefixes].sort()).toEqual(['replays-sort-', 'servers-row-'])
    expect([...ids.mentions]).toEqual(['config-tab-aliases'])
  })

  test('a renderer file owns literal, prop and template-prefix testids', () => {
    const { exact, prefixes } = testIdOwners([
      {
        path: 'src/renderer/src/A.tsx',
        source:
          '<div data-testid="a-one" /><Row testId="a-two" confirmTestId={\'a-three\'} />' +
          "<li data-testid={`a-row-${id}`} /><X testIds={{ cancel: 'a-cancel' }} />",
      },
      { path: 'src/renderer/src/B.tsx', source: 'const tabs = [{ testId: `b-tab-${x.id}` }]' },
    ])
    expect([...exact.keys()].sort()).toEqual(['a-cancel', 'a-one', 'a-three', 'a-two'])
    expect([...prefixes.keys()].sort()).toEqual(['a-row-', 'b-tab-'])
    expect([...prefixes.get('b-tab-')]).toEqual(['src/renderer/src/B.tsx'])
  })

  test('a flow is selected through a renderer testid, its own file, a helper or an area row', () => {
    const flows = [
      flow('rows', "page.getByTestId('servers-row-10.0.0.1')"),
      flow('tabs', 'page.locator(\'[data-testid^="config-tab-"]\')', ['scripts/lib/tabs.mjs']),
      flow('boot', ''),
      flow('other', "page.getByTestId('unrelated-id')"),
    ]
    const rendererFiles = [
      { path: 'src/renderer/src/Row.tsx', source: '<tr data-testid={`servers-row-${a}`} />' },
      { path: 'src/renderer/src/Tabs.tsx', source: '<Tab testId="config-tab-raw" />' },
    ]
    const areas = [{ area: 'boot', paths: ['src/main/lib/**'], flows: ['boot'], why: 'w' }]
    const run = (...changedFiles) =>
      selectAffected({ changedFiles, flows, rendererFiles, areas }).map((pick) => pick.flow)
    expect(run('src/renderer/src/Row.tsx')).toEqual(['rows'])
    expect(run('src/renderer/src/Tabs.tsx')).toEqual(['tabs'])
    expect(run('scripts/lib/tabs.mjs')).toEqual(['tabs'])
    expect(run('scripts/flows/other.mjs')).toEqual(['other'])
    expect(run('src/main/lib/boot-env.ts')).toEqual(['boot'])
    expect(run('src/renderer/src/Row.tsx', 'src/main/lib/boot-env.ts')).toEqual(['boot', 'rows'])
  })

  test('test files, test support and docs select nothing', () => {
    const flows = [flow('boot', '')]
    const areas = [{ area: 'all', paths: ['**'], flows: ['boot'], why: 'w' }]
    const changedFiles = [
      'src/main/lib/boot-env.test.ts',
      'src/test-support/builders.ts',
      'src/main/modules/config/index.test-helpers.ts',
      'docs/ARCHITECTURE.md',
      'CHANGELOG.md',
    ]
    expect(selectAffected({ changedFiles, flows, areas })).toEqual([])
  })

  test('helper resolution follows relative imports transitively, inside the given sources only', () => {
    const sources = {
      'scripts/flows/f.mjs':
        "import {\n  a,\n  b,\n} from '../lib/a.mjs'\nimport { x } from 'node:fs'",
      'scripts/lib/a.mjs': "export * from './b.mjs'\nconst c = await import('./c.mjs')",
      'scripts/lib/b.mjs': "import { REPO_ROOT } from './missing.mjs'",
      'scripts/lib/c.mjs': '',
    }
    expect(helperClosure('scripts/flows/f.mjs', sources)).toEqual([
      'scripts/lib/a.mjs',
      'scripts/lib/b.mjs',
      'scripts/lib/c.mjs',
    ])
  })

  test('an area table with an unknown flow or more than 12 flows is refused', () => {
    const names = Array.from({ length: 13 }, (_, k) => `f-${k}`)
    expect(
      validateAreas([{ area: 'a', paths: ['x'], flows: ['ghost'], why: 'w' }], names)[0],
    ).toContain('ghost')
    expect(
      validateAreas([{ area: 'a', paths: ['x'], flows: ['f-*'], why: 'w' }], names)[0],
    ).toContain('selects 13 flows')
    expect(validateAreas([{ area: 'a', paths: [], flows: ['f-1'] }], names)).toHaveLength(2)
  })
})
