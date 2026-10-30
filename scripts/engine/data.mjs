// Fetches, verifies and caches the shareware pak0.pak the engine test lane runs against. The
// cache lives outside the repo so game data can never be committed by accident.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const DEFAULT_LOCK = join(REPO_ROOT, 'tests', 'engine', 'data.lock.json')
const PAK_CANDIDATES = ['baseq2/pak0.pak', 'Install/Data/baseq2/pak0.pak']

export function resolveCacheDir(env = process.env, platform = process.platform) {
  const p = platform === 'win32' ? win32 : posix
  if (env.Q2L_ENGINE_DATA) return p.resolve(env.Q2L_ENGINE_DATA)
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || p.join(homedir(), 'AppData', 'Local')
    return p.resolve(base, 'q2l-engine-test')
  }
  const base = env.XDG_CACHE_HOME || p.join(homedir(), '.cache')
  return p.resolve(base, 'q2l-engine-test')
}

/** Lexical containment, same semantics as `isInside` in src/main/lib/fs-utils.ts. */
function isInside(root, target, platform) {
  const p = platform === 'win32' ? win32 : posix
  const fold = (s) => (platform === 'win32' || platform === 'darwin' ? s.toLowerCase() : s)
  const rel = p.relative(fold(p.resolve(root)), fold(p.resolve(target)))
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel)
}

export function assertOutsideRepo(cacheDir, repoRoot = REPO_ROOT, platform = process.platform) {
  if (isInside(repoRoot, cacheDir, platform)) {
    throw new Error(
      `engine data cache ${cacheDir} is inside the repo ${repoRoot}; point Q2L_ENGINE_DATA outside it`,
    )
  }
}

export function readLock(path = DEFAULT_LOCK) {
  const lock = JSON.parse(readFileSync(path, 'utf8'))
  if (!lock.archive?.url || !lock.archive?.sha256 || !lock.pak0?.sha256) {
    throw new Error(`malformed engine data lock ${path}`)
  }
  return lock
}

export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

export function sevenZipPath() {
  const name = process.platform === 'win32' ? '7za.exe' : '7zz'
  return join(REPO_ROOT, 'resources', 'bin', name)
}

export function assertSevenZip(binary = sevenZipPath()) {
  if (!existsSync(binary)) {
    throw new Error(`vendored 7-Zip missing at ${binary}; run \`npm run fetch:7za\``)
  }
}

export async function downloadFile(url, destination) {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`)
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()))
}

export function extractArchive(archive, outDir, binary = sevenZipPath()) {
  assertSevenZip(binary)
  execFileSync(binary, ['x', archive, `-o${outDir}`, '-y'], { stdio: 'ignore' })
}

function assertHash(what, expected, actual) {
  if (expected !== actual) {
    throw new Error(`${what} SHA-256 mismatch\n  expected ${expected}\n  actual   ${actual}`)
  }
}

function cachedMarkerMatches(lock, cacheDir) {
  const marker = join(cacheDir, 'data.lock.json')
  if (!existsSync(marker) || !existsSync(join(cacheDir, 'baseq2', 'pak0.pak'))) return false
  try {
    return JSON.parse(readFileSync(marker, 'utf8')).archive?.sha256 === lock.archive.sha256
  } catch {
    return false
  }
}

/** Ends by logging the cache path, so a CLI caller can read it from the last output line. */
export async function ensureEngineData({
  lock,
  cacheDir,
  download = downloadFile,
  extract = extractArchive,
  log = console.log,
}) {
  const pakTarget = join(cacheDir, 'baseq2', 'pak0.pak')

  if (cachedMarkerMatches(lock, cacheDir)) {
    assertHash('pak0.pak', lock.pak0.sha256, sha256File(pakTarget))
    log('cached')
    log(cacheDir)
    return { cacheDir, cached: true }
  }

  const tmp = join(cacheDir, '.tmp')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    const archive = join(tmp, lock.archive.fileName ?? 'archive.bin')
    let lastError
    let downloaded = false
    for (const url of [lock.archive.url, ...(lock.archive.mirrors ?? [])]) {
      try {
        log(`downloading ${url}`)
        await download(url, archive)
        downloaded = true
        break
      } catch (error) {
        lastError = error
        log(`failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (!downloaded) throw lastError ?? new Error('no download url in the lock')
    assertHash('archive', lock.archive.sha256, sha256File(archive))

    const out = join(tmp, 'out')
    mkdirSync(out)
    await extract(archive, out)
    const found = PAK_CANDIDATES.map((c) => join(out, ...c.split('/'))).find((c) => existsSync(c))
    if (!found) {
      throw new Error(`pak0.pak not found in the archive (tried ${PAK_CANDIDATES.join(', ')})`)
    }
    assertHash('pak0.pak', lock.pak0.sha256, sha256File(found))

    mkdirSync(dirname(pakTarget), { recursive: true })
    rmSync(pakTarget, { force: true })
    try {
      renameSync(found, pakTarget)
    } catch {
      copyFileSync(found, pakTarget)
    }
    writeFileSync(join(cacheDir, 'data.lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  log(cacheDir)
  return { cacheDir, cached: false }
}
