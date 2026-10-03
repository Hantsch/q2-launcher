import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Docs checker: every relative `.md` link in CLAUDE.md, README.md, CONTRIBUTING.md and docs/**\/*.md
 * resolves to a file, and README's `**Status: ... (x.y.z)...**` line carries package.json's version.
 * `node scripts/check-docs.mjs [--fix]` prints findings and exits 1 if any remain.
 */

const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git'])
const ROOT_DOCS = ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md']

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, visit)
    else visit(full)
  }
}

function docFiles(root) {
  const files = ROOT_DOCS.map((f) => path.join(root, f)).filter((f) => existsSync(f))
  const docs = path.join(root, 'docs')
  if (existsSync(docs) && statSync(docs).isDirectory()) {
    walk(docs, (f) => {
      if (f.endsWith('.md')) files.push(f)
    })
  }
  return files
}

/** Links in a markdown source: `{ target, start, end }` of the target text, outside fences/code. */
function extractLinks(text) {
  const links = []
  let inFence = false
  let fenceMarker = ''
  let offset = 0
  for (const line of text.split('\n')) {
    const fence = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) {
        inFence = false
      }
    } else if (!inFence) {
      // Blank out inline code spans (same length, so offsets stay valid).
      const masked = line.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length))
      for (const m of masked.matchAll(/\]\(([^)\s]+)\)/g)) {
        const start = offset + m.index + 2
        links.push({ target: m[1], start, end: start + m[1].length })
      }
    }
    offset += line.length + 1
  }
  return links
}

function splitTarget(target) {
  const hash = target.indexOf('#')
  return hash === -1
    ? { file: target, anchor: '' }
    : { file: target.slice(0, hash), anchor: target.slice(hash) }
}

function isCheckable(target) {
  if (target.startsWith('#')) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith('//')) return false
  return splitTarget(target).file.endsWith('.md')
}

function decode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function findBroken(root) {
  const broken = []
  for (const file of docFiles(root)) {
    const text = readFileSync(file, 'utf8')
    for (const link of extractLinks(text)) {
      if (!isCheckable(link.target)) continue
      const resolved = path.resolve(path.dirname(file), decode(splitTarget(link.target).file))
      if (!existsSync(resolved)) broken.push({ file, target: link.target, link })
    }
  }
  return broken
}

function readmeVersion(root) {
  const readme = path.join(root, 'README.md')
  if (!existsSync(readme)) return null
  const line = readFileSync(readme, 'utf8')
    .split('\n')
    .find((l) => /\*\*Status:/.test(l))
  const m = line && /\((\d+\.\d+\.\d+[^)\s]*)\)/.exec(line)
  return m ? m[1] : null
}

export function checkDocs(root) {
  const brokenLinks = findBroken(root).map(({ file, target }) => ({
    file: path.relative(root, file).split(path.sep).join('/'),
    target,
  }))
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
  const readme = readmeVersion(root)
  const debtFile = path.join(root, 'docs', 'TECH-DEBT.md')
  const techDebtErrors = existsSync(debtFile) ? checkTechDebt(readFileSync(debtFile, 'utf8')) : []
  return { brokenLinks, versionMismatch: readme === pkg ? null : { readme, pkg }, techDebtErrors }
}

const DEBT_FIELDS = ['id', 'since', 'area', 'sev', 'item', 'source']

/** Cells of a markdown table row; `\|` stays inside its cell. */
function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())
}

/**
 * Parses docs/TECH-DEBT.md: the `Next id: TD-NNN` line and the table rows below the header row.
 * `nextId` is the number (null when the line is missing or malformed).
 */
export function parseTechDebt(markdown) {
  const next = /^Next id:\s*TD-(\d+)\s*$/m.exec(markdown)
  const rows = []
  let inTable = false
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) {
      inTable = false
      continue
    }
    const cells = tableCells(line)
    if (!inTable) {
      inTable = cells[0] === 'id'
      continue
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    const row = { raw: cells }
    DEBT_FIELDS.forEach((f, i) => (row[f] = cells[i] ?? ''))
    rows.push(row)
  }
  return { rows, nextId: next ? Number(next[1]) : null }
}

/** Error strings for a malformed TECH-DEBT.md; an empty array means valid. */
export function checkTechDebt(markdown) {
  const { rows, nextId } = parseTechDebt(markdown)
  const errors = []
  if (nextId === null) errors.push('missing or invalid "Next id: TD-NNN" line')
  const seen = new Set()
  for (const row of rows) {
    const label = row.id || '(row without id)'
    for (const f of DEBT_FIELDS) if (!row[f]) errors.push(`${label}: missing ${f}`)
    if (row.id && !/^TD-\d+$/.test(row.id)) errors.push(`${label}: id is not TD-NNN`)
    if (row.since && !/^S\d\d$/.test(row.since))
      errors.push(`${label}: since "${row.since}" is not SNN`)
    if (row.sev && !['high', 'med', 'low'].includes(row.sev)) {
      errors.push(`${label}: sev "${row.sev}" is not high|med|low`)
    }
    if (row.id && seen.has(row.id)) errors.push(`${label}: duplicate id`)
    seen.add(row.id)
    const num = /^TD-(\d+)$/.exec(row.id)
    if (num && nextId !== null && Number(num[1]) >= nextId) {
      errors.push(`${label}: id is not below Next id TD-${String(nextId).padStart(3, '0')}`)
    }
    if (row.source && !/\]\([^)\s]+\)/.test(row.source)) errors.push(`${label}: source has no link`)
  }
  return errors
}

/**
 * Rows more than three sprints old. `currentSprint` is a number (33) or a string ('S33').
 * A row exactly three sprints old is not overdue.
 */
export function overdueTechDebt(rows, currentSprint) {
  const current =
    typeof currentSprint === 'number' ? currentSprint : Number(/\d+/.exec(currentSprint)?.[0])
  return rows.filter((r) => {
    const since = /^S(\d+)$/.exec(r.since)
    return since && current - Number(since[1]) > 3
  })
}

/** Highest SNN directory under docs/sprints/ and docs/sprints/done/. */
function latestSprint(root) {
  let max = 0
  for (const dir of [
    path.join(root, 'docs', 'sprints'),
    path.join(root, 'docs', 'sprints', 'done'),
  ]) {
    if (!existsSync(dir)) continue
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const m = e.isDirectory() && /^S(\d+)$/.exec(e.name)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return max
}

function allFiles(root) {
  const out = []
  walk(root, (f) => out.push(f.split(path.sep).join('/')))
  return out
}

export function fixDocs(root) {
  const files = allFiles(root)
  const fixed = []
  const unresolved = []
  const edits = new Map() // abs file -> [{ start, end, text }]
  for (const { file, target, link } of findBroken(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/')
    const { file: bare, anchor } = splitTarget(target)
    const segments = decode(bare)
      .split('/')
      .filter((s) => s && s !== '.' && s !== '..')
    let candidates = files
    let found = null
    for (let n = 1; n <= segments.length; n++) {
      const suffix = '/' + segments.slice(-n).join('/')
      candidates = files.filter((f) => f.endsWith(suffix))
      if (candidates.length <= 1) break
    }
    if (candidates.length === 1) found = candidates[0]
    if (!found) {
      unresolved.push({ file: rel, target })
      continue
    }
    const next = path.relative(path.dirname(file), found).split(path.sep).join('/')
    const text = next + anchor
    if (!edits.has(file)) edits.set(file, [])
    edits.get(file).push({ start: link.start, end: link.end, text })
    fixed.push({ file: rel, target, to: text })
  }
  for (const [file, list] of edits) {
    const raw = readFileSync(file)
    let src = raw.toString('utf8')
    // A file with invalid UTF-8 bytes would be corrupted by the decode/encode round trip:
    // its links are reported as unresolved and fixed by hand.
    if (!Buffer.from(src, 'utf8').equals(raw)) {
      const rel = path.relative(root, file).split(path.sep).join('/')
      for (let i = fixed.length - 1; i >= 0; i--) {
        if (fixed[i].file !== rel) continue
        unresolved.push({ file: rel, target: fixed[i].target })
        fixed.splice(i, 1)
      }
      continue
    }
    for (const e of list.sort((a, b) => b.start - a.start)) {
      src = src.slice(0, e.start) + e.text + src.slice(e.end)
    }
    writeFileSync(file, src)
  }
  return { fixed, unresolved }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  if (process.argv.includes('--fix')) {
    const { fixed, unresolved } = fixDocs(root)
    for (const f of fixed) console.log(`fixed ${f.file}: ${f.target} -> ${f.to}`)
    for (const u of unresolved) console.log(`unresolved ${u.file}: ${u.target}`)
  }
  if (process.argv.includes('--overdue')) {
    const debtFile = path.join(root, 'docs', 'TECH-DEBT.md')
    const rows = existsSync(debtFile) ? parseTechDebt(readFileSync(debtFile, 'utf8')).rows : []
    const late = overdueTechDebt(rows, latestSprint(root))
    if (late.length === 0) console.log('no overdue tech-debt rows')
    for (const r of late) console.log(`${r.id} ${r.since} ${r.item}`)
    process.exit(0)
  }
  const { brokenLinks, versionMismatch, techDebtErrors } = checkDocs(root)
  for (const e of techDebtErrors) console.log(`TECH-DEBT.md: ${e}`)
  for (const b of brokenLinks) console.log(`broken link in ${b.file}: ${b.target}`)
  if (versionMismatch) {
    console.log(
      `README version ${versionMismatch.readme ?? '(missing Status line)'} != package.json ${versionMismatch.pkg}`,
    )
  }
  process.exit(brokenLinks.length > 0 || versionMismatch || techDebtErrors.length > 0 ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
