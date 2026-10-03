import { readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, posix, relative, resolve, sep } from 'node:path'
import { sourceFiles } from './source-files'

/**
 * A regex-level view of the source tree for architecture tests: which files exist and what each
 * one imports. Paths are repo-relative and POSIX (`/`) on every platform, so rules and allowlists
 * can be written once.
 */

export const REPO_ROOT = resolve(__dirname, '..', '..')

const SOURCE_FILE = /\.tsx?$/
// A `test/` directory holds a module's shared test harness, which is test code too.
const TEST_FILE = /(\.(test|spec)\.tsx?$|\/test\/)/

/** Every `.ts`/`.tsx` file under `dirRepoRel`, recursively, as sorted repo-relative POSIX paths. */
export function listSourceFiles(dirRepoRel: string): string[] {
  return sourceFiles(join(REPO_ROOT, dirRepoRel))
    .filter((file) => SOURCE_FILE.test(file))
    .map((file) => relative(REPO_ROOT, file).split(sep).join('/'))
    .sort()
}

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path)
}

export function readRepoFile(pathRepoRel: string): string {
  return readFileSync(join(REPO_ROOT, pathRepoRel), 'utf-8')
}

// A `/` after one of these (or at the start) begins a regex literal, not a division.
const REGEX_PRECEDER = /[(,=:[!&|?{};+\-*%<>~^]/
const REGEX_PRECEDER_WORDS = /\b(return|typeof|case|do|else|in|of|void|yield|await)$/

interface Lexed {
  code: string
  comments: { start: number; end: number }[]
}

// One lexer for both views: `code` is the source with each comment replaced by a space, `comments`
// the [start, end) offsets of those comments. String, template and regex literals are skipped
// intact, so a `//` inside a URL or a quote inside a regex does not derail the scan.
function lex(source: string): Lexed {
  let out = ''
  const comments: Lexed['comments'] = []
  let i = 0
  const n = source.length
  // Open brace depth of each `${ … }` template expression being lexed as code.
  const templateDepths: number[] = []
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      const start = i
      while (i < n && source[i] !== '\n') i++
      comments.push({ start, end: i })
      out += ' '
      continue
    }
    if (c === '/' && next === '*') {
      const start = i
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      comments.push({ start, end: i })
      out += ' '
      continue
    }
    if (c === '"' || c === "'") {
      const start = i++
      while (i < n && source[i] !== c) i += source[i] === '\\' ? 2 : 1
      out += source.slice(start, ++i)
      continue
    }
    const closesExpression = c === '}' && templateDepths[templateDepths.length - 1] === 0
    if (c === '`' || closesExpression) {
      // Template text runs to the closing backtick or to a `${`, whose expression is lexed as code.
      if (closesExpression) templateDepths.pop()
      const start = i++
      while (i < n && source[i] !== '`' && !(source[i] === '$' && source[i + 1] === '{'))
        i += source[i] === '\\' ? 2 : 1
      if (source[i] === '$') {
        i += 2
        templateDepths.push(0)
      } else i++
      out += source.slice(start, Math.min(i, n))
      continue
    }
    if (templateDepths.length > 0 && (c === '{' || c === '}'))
      templateDepths[templateDepths.length - 1] += c === '{' ? 1 : -1
    if (c === '/' && startsRegex(out)) {
      const start = i++
      let inClass = false
      while (i < n && source[i] !== '\n' && (inClass || source[i] !== '/')) {
        if (source[i] === '\\') i++
        else if (source[i] === '[') inClass = true
        else if (source[i] === ']') inClass = false
        i++
      }
      out += source.slice(start, ++i)
      continue
    }
    out += c
    i++
  }
  return { code: out, comments }
}

/** `source` with every `//` and `/* *\/` comment replaced by a space. */
export function stripComments(source: string): string {
  return lex(source).code
}

/** Every comment in `source` with its text and 1-based first and last line. */
export function commentRanges(
  source: string,
): { text: string; startLine: number; endLine: number }[] {
  const lineAt = (offset: number): number => {
    let line = 1
    for (let k = source.indexOf('\n'); k !== -1 && k < offset; k = source.indexOf('\n', k + 1))
      line++
    return line
  }
  return lex(source).comments.map(({ start, end }) => ({
    text: source.slice(start, end),
    startLine: lineAt(start),
    endLine: lineAt(Math.max(start, end - 1)),
  }))
}

function startsRegex(before: string): boolean {
  const trimmed = before.trimEnd()
  if (trimmed === '') return true
  return REGEX_PRECEDER.test(trimmed[trimmed.length - 1]) || REGEX_PRECEDER_WORDS.test(trimmed)
}

const SPEC = String.raw`\s*['"\x60]([^'"\x60]+)['"\x60]`
// The clause before `from` is restricted to identifier, brace, comma, `*` and whitespace characters
// so a match cannot run past a string literal into an unrelated statement.
const IMPORT_PATTERNS = [
  new RegExp(String.raw`\bimport\s+(?:type\s+)?[\w$*{}\s,]+?\s*\bfrom` + SPEC, 'g'),
  new RegExp(String.raw`\bexport\s+(?:type\s+)?[\w$*{}\s,]*?\s*\bfrom` + SPEC, 'g'),
  // Side-effect imports are anchored to a statement start: unanchored, a string ending in `import`
  // followed by any later quote would read as one.
  new RegExp(String.raw`(?:^|;)[ \t]*import\s*['"]([^'"\n]+)['"]`, 'gm'),
  new RegExp(String.raw`\bimport\s*\(` + SPEC + String.raw`\s*\)`, 'g'),
  new RegExp(String.raw`\brequire\s*\(` + SPEC + String.raw`\s*\)`, 'g'),
]

/** Every module specifier `sourceText` imports, re-exports, requires or dynamically imports. */
export function scanImports(sourceText: string): string[] {
  const code = stripComments(sourceText)
  const found: Array<{ at: number; spec: string }> = []
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) found.push({ at: match.index, spec: match[1] })
  }
  return found.sort((a, b) => a.at - b.at).map((hit) => hit.spec)
}

// Mirrors the `paths` of tsconfig.node.json / tsconfig.web.json and the electron-vite aliases.
const ALIASES: ReadonlyArray<[prefix: string, target: string]> = [
  ['@shared/', 'src/shared/'],
  ['@main/', 'src/main/'],
  ['@renderer/', 'src/renderer/src/'],
]

const CODE_EXTENSION = /\.(tsx?|jsx?|mjs|cjs)$/

/**
 * Where `spec`, imported from `fromFile`, points: a repo-relative POSIX path without code
 * extension (a directory import becomes `<dir>/index`), or a bare specifier unchanged.
 */
export function resolveSpecifier(fromFile: string, spec: string): string {
  const alias = ALIASES.find(([prefix]) => spec.startsWith(prefix))
  let path: string
  if (alias) path = alias[1] + spec.slice(alias[0].length)
  else if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../'))
    path = posix.join(posix.dirname(fromFile), spec)
  else return spec
  path = posix.normalize(path.replace(/\?.*$/, '')).replace(CODE_EXTENSION, '')
  return isDirectory(path) ? `${path}/index` : path
}

const NODE_BUILTINS = new Set(builtinModules)

/** Whether `resolved` (a `resolveSpecifier` result) is a Node builtin (bare or `node:`) or electron. */
export function isNodeOrElectron(resolved: string): boolean {
  return (
    resolved.startsWith('node:') ||
    NODE_BUILTINS.has(resolved) ||
    resolved === 'electron' ||
    resolved.startsWith('electron/')
  )
}

function isDirectory(pathRepoRel: string): boolean {
  try {
    return statSync(join(REPO_ROOT, pathRepoRel)).isDirectory()
  } catch {
    return false
  }
}
