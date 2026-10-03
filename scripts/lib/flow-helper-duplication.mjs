// Finds helpers re-declared across flow scripts. Regex-based (no parser dependency): flows keep
// module-level declarations at column 0, so a declaration ends at the next column-0 statement.
export const MAX_COPIES = 3
const EXEMPT = new Set(['default', 'setup', 'teardown', 'variant', 'expectExit'])

function isFunctionInit(rest) {
  const m = /^\s*(?:async\s+)?/.exec(rest)
  let i = m[0].length
  if (/^function\b/.test(rest.slice(i))) return true
  if (rest[i] !== '(') return /^\w+\s*=>/.test(rest.slice(i))
  let depth = 0
  for (; i < rest.length; i++) {
    if (rest[i] === '(') depth++
    else if (rest[i] === ')' && --depth === 0) return /^\s*(?::[^=]*)?=>/.test(rest.slice(i + 1))
  }
  return false
}

/** Whitespace-collapsed text with the declared name (first occurrence, in the declaration line)
 * replaced by a placeholder, so identical helpers under different names compare equal. */
function normaliseBody(name, lines) {
  const head = lines[0].replace(new RegExp(`\\b${name}\\b`), '<name>')
  return [head, ...lines.slice(1)].join('\n').replace(/\s+/g, ' ').trim()
}

/** Module-level function declarations and arrow/function-expression bindings: `[{name, body}]`. */
export function collectHelpers(source) {
  const lines = source.split(/\r?\n/)
  const out = []
  let current = null
  const flush = () => {
    if (current) out.push({ name: current.name, body: normaliseBody(current.name, current.lines) })
    current = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const continuation = line === '' || /^[\s})\]]/.test(line)
    if (current && continuation) {
      current.lines.push(line)
      continue
    }
    flush()
    const fn = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/.exec(line)
    if (fn) {
      current = { name: fn[1], lines: [line] }
      continue
    }
    const bind = /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=(.*)$/.exec(line)
    if (bind && isFunctionInit([bind[2], ...lines.slice(i + 1, i + 12)].join('\n'))) {
      current = { name: bind[1], lines: [line] }
    }
  }
  flush()
  return out.filter((h) => !EXEMPT.has(h.name))
}

/** `files` is `{filename: source}`; returns one message per name or body in more than MAX_COPIES files. */
export function findDuplicatedHelpers(files) {
  const byName = new Map()
  const byBody = new Map()
  for (const [file, source] of Object.entries(files)) {
    const names = new Set()
    const bodies = new Map()
    for (const h of collectHelpers(source)) {
      names.add(h.name)
      if (!bodies.has(h.body)) bodies.set(h.body, h.name)
    }
    for (const n of names) byName.set(n, [...(byName.get(n) ?? []), file])
    for (const [b, n] of bodies)
      byBody.set(b, { name: n, files: [...(byBody.get(b)?.files ?? []), file] })
  }
  const problems = []
  for (const [name, fs] of byName) {
    if (fs.length > MAX_COPIES)
      problems.push(`"${name}" is declared in ${fs.length} flows: ${fs.join(', ')}`)
  }
  for (const { name, files: fs } of byBody.values()) {
    if (fs.length > MAX_COPIES)
      problems.push(`the body of "${name}" is declared in ${fs.length} flows: ${fs.join(', ')}`)
  }
  return problems
}
