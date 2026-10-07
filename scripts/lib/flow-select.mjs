// Which flows a change can break. Pure: no spawning, no filesystem, no git — the caller passes
// file lists and file contents in. Flows drive the built app and import nothing from src/, so
// an import graph cannot reach them; instead a flow's renderer files are derived from the
// data-testids it uses, and every other source file maps through the area table
// (scripts/flows/areas.json).

import { posix } from 'node:path'

export const MAX_FLOWS_PER_AREA = 12

const TEST_GLOBS = [
  '**/*.test.*',
  '**/*.test-helpers.*',
  '**/test-support.*',
  '**/test-support/**',
  '**/__snapshots__/**',
  '**/__fixtures__/**',
  '**/fixtures/**',
  'src/renderer/src/modules/config/test/**',
]
const DOC_GLOBS = ['docs/**', '**/*.md']
const FLOW_FILE = /^scripts\/flows\/([^/]+)\.mjs$/

// Kebab-case with at least one hyphen: every testid in the app has this shape, and almost no
// other string literal in a flow does, so a literal of this shape handed to a helper (which then
// calls getByTestId(param)) still counts as a testid the flow depends on.
const TESTID_SHAPE = /^[a-z][a-z0-9]*(?:-[a-zA-Z0-9]+)+$/
const TESTID_PREFIX_SHAPE = /^[a-z][a-z0-9]*(?:-[a-zA-Z0-9]+)*-$/

export function normalisePath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '')
}

const globCache = new Map()

/** `**` spans directories (`a/**\/b` also matches `a/b`), `*` and `?` stay inside one segment. */
export function globToRegExp(glob) {
  let cached = globCache.get(glob)
  if (cached) return cached
  let source = ''
  for (let k = 0; k < glob.length; k++) {
    const char = glob[k]
    if (char === '*' && glob[k + 1] === '*') {
      if (glob[k + 2] === '/') {
        source += '(?:.*/)?'
        k += 2
      } else {
        source += '.*'
        k += 1
      }
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  cached = new RegExp(`^${source}$`)
  globCache.set(glob, cached)
  return cached
}

export function matchesGlob(path, glob) {
  return globToRegExp(glob).test(normalisePath(path))
}

const matchesAny = (path, globs) => globs.some((glob) => matchesGlob(path, glob))

export const isTestFile = (path) => matchesAny(path, TEST_GLOBS)
export const isDocFile = (path) => matchesAny(path, DOC_GLOBS)

/** Reads the string or template literal opening at `source[start]`; `null` when there is none. */
function readLiteral(source, start) {
  const quote = source[start]
  if (quote === "'" || quote === '"') {
    const end = source.indexOf(quote, start + 1)
    if (end === -1) return null
    const text = source.slice(start + 1, end)
    return text.includes('\n') ? null : { kind: 'exact', text, end: end + 1 }
  }
  if (quote !== '`') return null
  let k = start + 1
  let head = null
  while (k < source.length && source[k] !== '`') {
    if (source[k] === '\\') k += 2
    else if (source[k] === '$' && source[k + 1] === '{') {
      if (head === null) head = source.slice(start + 1, k)
      k = skipBalanced(source, k + 1)
    } else k += 1
  }
  if (head === null) return { kind: 'exact', text: source.slice(start + 1, k), end: k + 1 }
  return { kind: 'prefix', text: head, end: k + 1 }
}

/** Index just past the `}` closing the `{` at `open`, skipping over nested literals. */
function skipBalanced(source, open) {
  let depth = 0
  let k = open
  while (k < source.length) {
    const char = source[k]
    if (char === "'" || char === '"' || char === '`') {
      const literal = readLiteral(source, k)
      k = literal ? literal.end : k + 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return k + 1
    }
    k += 1
  }
  return k
}

/** Every literal in an expression; a template contributes its static head as a prefix. */
function literalsIn(expression, into) {
  for (let k = 0; k < expression.length; k++) {
    const literal = readLiteral(expression, k)
    if (!literal) continue
    if (literal.kind === 'exact' && literal.text !== '') into.exact.add(literal.text)
    if (literal.kind === 'prefix' && literal.text !== '') into.prefixes.add(literal.text)
    k = literal.end - 1
  }
}

// Prose in comments ("don't") would pair quotes across real literals on the scan.
const withoutCommentLines = (source) => source.replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '')

const emptyIds = () => ({ exact: new Set(), prefixes: new Set(), mentions: new Set() })

function addSelectorIds(source, ids) {
  for (const match of source.matchAll(/getByTestId\(\s*/g)) {
    const literal = readLiteral(source, match.index + match[0].length)
    if (!literal || literal.text === '') continue
    ;(literal.kind === 'exact' ? ids.exact : ids.prefixes).add(literal.text)
  }
  for (const match of source.matchAll(/data-testid([\^*$~|]?)=\s*\\?["']?([^"'\]\\]*)/g)) {
    const [, operator, value] = match
    const dynamic = value.indexOf('${')
    if (dynamic !== -1) {
      if (dynamic > 0) ids.prefixes.add(value.slice(0, dynamic))
    } else if (value !== '' && operator === '') ids.exact.add(value)
    else if (value !== '' && operator === '^') ids.prefixes.add(value)
  }
  for (let k = 0; k < source.length; k++) {
    const literal = readLiteral(source, k)
    if (!literal) continue
    if (literal.kind === 'exact' && TESTID_SHAPE.test(literal.text)) ids.mentions.add(literal.text)
    if (literal.kind === 'prefix' && TESTID_PREFIX_SHAPE.test(literal.text)) {
      ids.prefixes.add(literal.text)
    }
    k = literal.end - 1
  }
}

/**
 * The testids a flow depends on, from its own source and the sources of the helpers it imports
 * (see helperClosure). `exact` and `prefixes` come from selectors (`getByTestId`, `[data-testid=]`,
 * `[data-testid^=]`, template literals up to their first `${`); `mentions` are testid-shaped
 * string literals anywhere, which covers ids handed to a helper as an argument.
 */
export function flowTestIds(flowSource, helperSources = []) {
  const ids = emptyIds()
  for (const source of [flowSource, ...helperSources])
    addSelectorIds(withoutCommentLines(source), ids)
  for (const id of ids.exact) ids.mentions.delete(id)
  return ids
}

const IMPORT_SPECIFIERS = [
  /(?:^|[\s;])(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?(['"])([^'"\n]+)\1/gm,
  /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g,
]

/**
 * Repo-relative paths of every module `entryPath` imports through relative specifiers,
 * transitively, limited to the paths present in `sourcesByPath` (a Map or object of
 * path -> source).
 */
export function helperClosure(entryPath, sourcesByPath) {
  const sources =
    sourcesByPath instanceof Map ? sourcesByPath : new Map(Object.entries(sourcesByPath))
  const entry = normalisePath(entryPath)
  const seen = new Set()
  const pending = [entry]
  while (pending.length > 0) {
    const path = pending.pop()
    const source = sources.get(path) ?? ''
    for (const pattern of IMPORT_SPECIFIERS) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[2]
        if (!specifier.startsWith('.')) continue
        const target = posix.normalize(posix.join(posix.dirname(path), specifier))
        if (target === entry || seen.has(target) || !sources.has(target)) continue
        seen.add(target)
        pending.push(target)
      }
    }
  }
  return [...seen].sort()
}

const OWNER_PROPERTY = /(?:data-testid|\b\w*[tT]est[Ii]ds?)\s*[=:]\s*/g

/** The testids one renderer source declares: `data-testid=`, `testId=` / `fooTestId=` props, `testId:` keys. */
export function declaredTestIds(source) {
  const ids = { exact: new Set(), prefixes: new Set() }
  for (const match of source.matchAll(OWNER_PROPERTY)) {
    const start = match.index + match[0].length
    if (source[start] === '{') {
      literalsIn(source.slice(start + 1, skipBalanced(source, start) - 1), ids)
      continue
    }
    const literal = readLiteral(source, start)
    if (!literal || literal.text === '') continue
    ;(literal.kind === 'exact' ? ids.exact : ids.prefixes).add(literal.text)
  }
  return ids
}

/**
 * testid -> the renderer files declaring it. `rendererFiles` is `[{ path, source }]`; ids built
 * from a template literal are keyed by their static prefix under `prefixes`.
 */
export function testIdOwners(rendererFiles) {
  const exact = new Map()
  const prefixes = new Map()
  const add = (map, id, path) => {
    if (!map.has(id)) map.set(id, new Set())
    map.get(id).add(path)
  }
  for (const { path, source } of rendererFiles) {
    const ids = declaredTestIds(source)
    for (const id of ids.exact) add(exact, id, normalisePath(path))
    for (const id of ids.prefixes) add(prefixes, id, normalisePath(path))
  }
  return { exact, prefixes }
}

/** The testids of `flowIds` that `owned` (one file's declaredTestIds) declares. */
export function sharedTestIds(flowIds, owned) {
  const hits = new Set()
  const byPrefix = (id) => [...owned.prefixes].some((prefix) => id.startsWith(prefix))
  for (const id of [...flowIds.exact, ...(flowIds.mentions ?? [])]) {
    if (owned.exact.has(id) || byPrefix(id)) hits.add(id)
  }
  for (const prefix of flowIds.prefixes) {
    const exactHit = [...owned.exact].find((id) => id.startsWith(prefix))
    if (exactHit) hits.add(exactHit)
    else if ([...owned.prefixes].some((p) => p.startsWith(prefix) || prefix.startsWith(p))) {
      hits.add(`${prefix}*`)
    }
  }
  return [...hits].sort()
}

/** Flow names an area row's `flows` entries (names or globs like `servers-*`) resolve to. */
export function areaFlows(row, flowNames) {
  const patterns = Array.isArray(row?.flows) ? row.flows : []
  return flowNames.filter((name) => patterns.some((pattern) => matchesGlob(name, pattern)))
}

/** Problems with the area table itself, each message naming the offending row. */
export function validateAreas(areas, flowNames) {
  if (!Array.isArray(areas)) return ['area table: expected an array of rows']
  const problems = []
  areas.forEach((row, index) => {
    const label = `area row ${index + 1}${row?.area ? ` (${row.area})` : ''}`
    if (row === null || typeof row !== 'object') {
      problems.push(`${label}: not an object`)
      return
    }
    for (const field of ['area', 'why']) {
      if (typeof row[field] !== 'string' || row[field].trim() === '') {
        problems.push(`${label}: missing field "${field}"`)
      }
    }
    for (const field of ['paths', 'flows']) {
      if (!Array.isArray(row[field]) || row[field].length === 0) {
        problems.push(`${label}: "${field}" must be a non-empty array`)
      }
    }
    for (const pattern of Array.isArray(row.flows) ? row.flows : []) {
      if (!flowNames.some((name) => matchesGlob(name, pattern))) {
        problems.push(`${label}: no flow in scripts/flows/ matches "${pattern}"`)
      }
    }
    const count = areaFlows(row, flowNames).length
    if (count > MAX_FLOWS_PER_AREA) {
      problems.push(`${label}: selects ${count} flows, at most ${MAX_FLOWS_PER_AREA} allowed`)
    }
  })
  return problems
}

/**
 * The flows a change can break, each with why it was picked. `flows` is
 * `[{ name, testIds, helpers? }]` (testIds from flowTestIds, helpers from helperClosure);
 * `rendererFiles` is `[{ path, source }]`. A flow is selected by its own file, by a helper it
 * imports, by a changed renderer file declaring one of its testids, or by a changed file inside
 * an area row naming it. Test files and docs select nothing.
 */
export function selectAffected({ changedFiles, flows, rendererFiles = [], areas = [] }) {
  const flowNames = flows.map((flow) => flow.name)
  const renderer = new Map(rendererFiles.map(({ path, source }) => [normalisePath(path), source]))
  const reasons = new Map()
  const pick = (name, reason) => {
    if (!reasons.has(name)) reasons.set(name, new Set())
    reasons.get(name).add(reason)
  }

  for (const changed of changedFiles.map(normalisePath)) {
    if (isTestFile(changed) || isDocFile(changed)) continue

    const flowFile = FLOW_FILE.exec(changed)
    if (flowFile && flowNames.includes(flowFile[1])) pick(flowFile[1], `${changed} is the flow`)

    for (const flow of flows) {
      if (flow.helpers?.includes(changed)) pick(flow.name, `${changed} is a helper it imports`)
    }

    if (renderer.has(changed)) {
      const owned = declaredTestIds(renderer.get(changed))
      for (const flow of flows) {
        for (const id of sharedTestIds(flow.testIds, owned)) {
          pick(flow.name, `${changed} declares testid "${id}"`)
        }
      }
    }

    for (const row of areas) {
      if (!row.paths.some((glob) => matchesGlob(changed, glob))) continue
      for (const name of areaFlows(row, flowNames))
        pick(name, `${changed} is in area "${row.area}"`)
    }
  }

  return [...reasons.keys()].sort().map((flow) => ({ flow, reasons: [...reasons.get(flow)] }))
}
