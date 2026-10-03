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
  return { brokenLinks, versionMismatch: readme === pkg ? null : { readme, pkg } }
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
  const { brokenLinks, versionMismatch } = checkDocs(root)
  for (const b of brokenLinks) console.log(`broken link in ${b.file}: ${b.target}`)
  if (versionMismatch) {
    console.log(
      `README version ${versionMismatch.readme ?? '(missing Status line)'} != package.json ${versionMismatch.pkg}`,
    )
  }
  process.exit(brokenLinks.length > 0 || versionMismatch ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
