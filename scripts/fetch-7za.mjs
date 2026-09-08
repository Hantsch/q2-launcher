// Story 071 D3: vendors the standalone `7za.exe` (+ its licence) into `resources/bin/`, the
// binary `src/main/modules/downloads/extractor.ts` spawns via `7za-path.ts` and
// `electron-builder.yml`'s `extraResources` ships alongside the packaged app.
//
// Run it by hand: `node scripts/fetch-7za.mjs` (or `npm run fetch:7za`, added to package.json).
// Idempotent: exits immediately, doing nothing, if `resources/bin/7za.exe` already exists - so it
// is safe to run on every fresh clone/CI setup without re-downloading.
//
// What it does:
//   1. Downloads the official 7-Zip "extra" package (the standalone-console variant, which needs
//      no companion DLL) for the pinned version below, from the standard www.7-zip.org download
//      location: https://www.7-zip.org/a/7z<version>-extra.7z
//   2. That archive is itself `.7z`-compressed, which is a real chicken-and-egg problem for a
//      from-scratch environment with no 7-Zip installed yet: this script does NOT ship a pure-JS
//      7z decompressor (out of scope for a one-off vendoring script). Instead it looks for an
//      already-installed 7-Zip/7za on the machine (`7z`, `7za`, or the default Windows install
//      path) and shells out to that to extract just `7za.exe` and `License.txt`.
//   3. If no local 7-Zip is found, the downloaded archive is left in place under
//      `resources/bin/.fetch-7za-tmp/` and the script prints the two files to extract by hand
//      (e.g. with 7-Zip File Manager, or any other tool that understands `.7z`) into
//      `resources/bin/`, then exits non-zero. This is expected and acceptable in a sandboxed
//      environment with no network access to 7-zip.org and no 7-Zip installed - see story
//      docs/requirements/071-downloads-are-verified-jobs.md, D3: "acceptable if you cannot
//      actually execute it end-to-end here."
//
// Network access to www.7-zip.org may not be available in every environment this repo is worked
// in (this script has not been run end-to-end in the sandbox this was authored in) - that is why
// `extractor.ts`/`extractor.test.ts` treat a missing binary as `downloads.error.extractorMissing`
// and gate their real-archive test on `existsSync`, rather than assuming this script has run.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN_DIR = join(REPO_ROOT, 'resources', 'bin')
const TARGET_BINARY = join(BIN_DIR, '7za.exe')
const TARGET_LICENSE = join(BIN_DIR, 'License.txt')

// Pinned 7-Zip version (Decisions (Sprint): "7za.exe ... for the current pinned version"). Bump
// deliberately, not automatically - a vendored executable is exactly the kind of dependency that
// should not silently float.
const SEVEN_ZIP_VERSION = '2409'
const EXTRA_ARCHIVE_URL = `https://www.7-zip.org/a/7z${SEVEN_ZIP_VERSION}-extra.7z`

const TMP_DIR = join(BIN_DIR, '.fetch-7za-tmp')
const TMP_ARCHIVE = join(TMP_DIR, `7z${SEVEN_ZIP_VERSION}-extra.7z`)

/** Local 7-Zip binaries this script tries, in order, to extract the downloaded archive with. */
const LOCAL_SEVENZIP_CANDIDATES = [
  '7z',
  '7za',
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
]

function findLocalSevenZip() {
  for (const candidate of LOCAL_SEVENZIP_CANDIDATES) {
    try {
      execFileSync(candidate, ['--help'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Not found / not runnable - try the next candidate.
    }
  }
  return undefined
}

async function downloadArchive() {
  const response = await fetch(EXTRA_ARCHIVE_URL)
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${EXTRA_ARCHIVE_URL}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  mkdirSync(TMP_DIR, { recursive: true })
  await writeFile(TMP_ARCHIVE, bytes)
}

async function main() {
  if (existsSync(TARGET_BINARY)) {
    console.log(`already vendored: ${TARGET_BINARY}`)
    return
  }

  mkdirSync(BIN_DIR, { recursive: true })

  console.log(`downloading ${EXTRA_ARCHIVE_URL} ...`)
  await downloadArchive()
  console.log(`downloaded to ${TMP_ARCHIVE}`)

  const sevenZip = findLocalSevenZip()
  if (!sevenZip) {
    console.error(
      [
        '',
        'No local 7-Zip found to extract the downloaded archive (tried: ' +
          LOCAL_SEVENZIP_CANDIDATES.join(', ') +
          ').',
        `The archive is at ${TMP_ARCHIVE}.`,
        `Extract "7za.exe" and "License.txt" from it into ${BIN_DIR} by hand (e.g. with 7-Zip`,
        'File Manager, or any tool that understands .7z), then re-run this script - it will see',
        'resources/bin/7za.exe already exists and skip re-downloading.',
        '',
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }

  console.log(`extracting with ${sevenZip} ...`)
  execFileSync(sevenZip, ['e', TMP_ARCHIVE, `-o${TMP_DIR}`, '-y', '7za.exe', 'License.txt'], {
    stdio: 'inherit',
  })

  renameSync(join(TMP_DIR, '7za.exe'), TARGET_BINARY)
  if (existsSync(join(TMP_DIR, 'License.txt'))) {
    renameSync(join(TMP_DIR, 'License.txt'), TARGET_LICENSE)
  }
  rmSync(TMP_DIR, { recursive: true, force: true })

  console.log(`vendored ${TARGET_BINARY}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
