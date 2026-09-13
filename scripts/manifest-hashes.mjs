// Story 070 D5: standalone, network-touching tool for the two shipped
// manifest files (`content/q2_community_content/engines/manifest.json` and
// `.../gamedata/manifest.json`). For each package it downloads `url` (falling
// back to `mirrors[0]` if `url` fails) and computes the real size + SHA256.
//
// Default mode is a report: print what was computed for every package.
// `--check` additionally compares each computed value against the manifest's
// own `sizeBytes`/`sha256` and exits non-zero (with one line per mismatch) if
// anything disagrees, exit 0 if everything matches.
//
// Deliberately NOT wired into `npm test` or CI: it downloads real (sometimes
// large) files over the network. Run it by hand: `node scripts/manifest-hashes.mjs [--check]`.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const MANIFEST_PATHS = [
  join(REPO_ROOT, 'content', 'q2_community_content', 'engines', 'manifest.json'),
  join(REPO_ROOT, 'content', 'q2_community_content', 'gamedata', 'manifest.json'),
]

function loadPackages(manifestPath) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  if (!Array.isArray(raw.packages)) {
    throw new Error(`${manifestPath}: no "packages" array`)
  }
  return raw.packages
}

/** Downloads `url`, computes size + sha256 (streamed, no full buffering). */
async function hashUrl(url) {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of response.body) {
    hash.update(chunk)
    size += chunk.length
  }
  return { size, sha256: hash.digest('hex') }
}

/** Downloads `pkg.url`, falling back to `pkg.mirrors[0]` if that fails. */
async function hashPackage(pkg) {
  const candidates = [pkg.url, pkg.mirrors?.[0]].filter(Boolean)
  let lastError
  for (const url of candidates) {
    try {
      return { url, ...(await hashUrl(url)) }
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`all candidate URLs failed for package "${pkg.id}": ${lastError?.message ?? 'no URL configured'}`)
}

async function main() {
  const check = process.argv.includes('--check')
  let mismatches = 0

  for (const manifestPath of MANIFEST_PATHS) {
    console.log(`\n${manifestPath}`)
    const packages = loadPackages(manifestPath)

    for (const pkg of packages) {
      process.stdout.write(`  ${pkg.id} ... `)
      let computed
      try {
        computed = await hashPackage(pkg)
      } catch (error) {
        console.log(`FAILED (${error.message})`)
        mismatches += 1
        continue
      }

      console.log(`size=${computed.size} sha256=${computed.sha256} (via ${computed.url})`)

      if (check) {
        if (computed.size !== pkg.sizeBytes) {
          console.log(`    MISMATCH sizeBytes: manifest=${pkg.sizeBytes} computed=${computed.size}`)
          mismatches += 1
        }
        if (computed.sha256 !== pkg.sha256) {
          console.log(`    MISMATCH sha256: manifest=${pkg.sha256} computed=${computed.sha256}`)
          mismatches += 1
        }
      }
    }
  }

  if (check) {
    if (mismatches > 0) {
      console.error(`\n${mismatches} mismatch(es)/failure(s) - see above`)
      process.exit(1)
    }
    console.log('\nall packages verified OK')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
